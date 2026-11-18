import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import type { QueuedMessage } from "../src/webview/protocol";

/**
 * `switchSession` flips the host's identity synchronously, but the webview
 * used to learn about the switch only after `fullResync` (~5 HTTP round-trips).
 * In that split-brain window the outgoing session's queue strip was still on
 * screen, and a click on it fired into the incoming session (issue 04a, Q9).
 * The fix posts a snapshot immediately after the synchronous clears, so the
 * webview flips to the incoming session at once.
 */
const switchSession = (
  ChatController.prototype as unknown as {
    switchSession: (id: string) => Promise<void>;
  }
).switchSession;

/** The prototype methods the real `switchSession` delegates to. */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

function message(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

interface RecordedSnapshot {
  sessionId: string | undefined;
  queue: QueuedMessage[];
}

function switchController(from: string, queue: QueuedMessage[]) {
  const recorded: RecordedSnapshot[] = [];
  let resyncStarted = false;
  const blocked = { resolve: () => {} };
  const resyncGate = new Promise<void>((resolve) => {
    blocked.resolve = resolve;
  });
  const controller = {
    sessionId: from,
    isSubagentSession: false,
    pendingAgent: undefined,
    pendingModel: undefined,
    busy: true,
    queue,
    queuePaused: false,
    pendingForce: undefined,
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    messages: [],
    pending: [],
    diffs: [],
    turnCache: undefined,
    dismissed: new Map<string, string>(),
    forms: [],
    context: { workspaceState: { update: async () => {} } },
    resetStreams: () => {},
    clearForms: () => {},
    clearSubagents: () => {},
    fullResync: async () => {
      resyncStarted = true;
      await resyncGate;
      // 真实 fullResync 收口时 post 权威快照；stub 保持同一契约。
      controller.postSnapshot();
    },
    drainRestoredQueue: () => {},
    stashQueue: proto.stashQueue,
    loadQueue: proto.loadQueue,
    stashDismissed: proto.stashDismissed,
    loadDismissed: proto.loadDismissed,
    storageKey: () => "test-key",
    postSnapshot() {
      recorded.push({ sessionId: controller.sessionId, queue: controller.queue });
    },
  };
  return { controller, recorded, blocked, resyncStarted: () => resyncStarted };
}

async function settleIntoSwitch(started: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !started(); i += 1) {
    await Promise.resolve();
  }
}

describe("session switch early snapshot", () => {
  test("the first snapshot carries the incoming session before the resync lands", async () => {
    const { controller, recorded, blocked, resyncStarted } = switchController("ses_a", [
      message("msg1"),
    ]);

    const switching = switchSession.call(
      controller as unknown as ChatController,
      "ses_b",
    );
    await settleIntoSwitch(resyncStarted);

    // The host has flipped, the resync is still pending — one snapshot must
    // already have flipped the webview to B, with B's (empty) queue, not A's.
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.sessionId, "ses_b");
    assert.deepEqual(recorded[0]?.queue, []);

    blocked.resolve();
    await switching;

    // The authoritative snapshot still follows the resync.
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1]?.sessionId, "ses_b");
  });

  test("the outgoing session's queue is parked before the flip", async () => {
    const { controller, blocked } = switchController("ses_a", [message("msg1")]);

    const switching = switchSession.call(
      controller as unknown as ChatController,
      "ses_b",
    );
    await settleIntoSwitch(() => true);
    blocked.resolve();
    await switching;

    assert.deepEqual(controller.sessionQueues.take("ses_a").items, [message("msg1")]);
  });
});
