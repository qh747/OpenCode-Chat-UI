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

const handleMessage = (
  ChatController.prototype as unknown as {
    handleMessage: (message: unknown) => Promise<void>;
  }
).handleMessage;

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
  /** 排水启动的排队消息:「已发送」的测试缝。 */
  const sent: QueuedMessage[] = [];
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
    // 与真类一致:queue 是当前会话键控状态的只读视图(不是自有数组)。
    get queue(): QueuedMessage[] {
      return controller.sessionQueues.state(controller.sessionId).items;
    },
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
    drainSwitchedQueue: proto.drainSwitchedQueue,
    drainQueue: proto.drainQueue,
    forceQueued: proto.forceQueued,
    startQueued(item: QueuedMessage) {
      sent.push(item);
    },
    postQueue: () => {},
    stashDismissed: proto.stashDismissed,
    loadDismissed: proto.loadDismissed,
    storageKey: () => "test-key",
    postSnapshot() {
      recorded.push({ sessionId: controller.sessionId, queue: controller.queue });
    },
  };
  // A 排队:消息进入其会话键下的队列状态(spec Q19)——状态按会话隔离,
  // 排队 push 写进 A 自己的条目,不再有任何模块级共享数组。
  for (const item of queue) {
    controller.sessionQueues.push(from, item);
  }
  return { controller, recorded, sent, blocked, resyncStarted: () => resyncStarted };
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

  test("the outgoing session's queue stays in its own keyed state across the flip", async () => {
    const { controller, blocked } = switchController("ses_a", [message("msg1")]);

    const switching = switchSession.call(
      controller as unknown as ChatController,
      "ses_b",
    );
    await settleIntoSwitch(() => true);
    blocked.resolve();
    await switching;

    // A 的排队消息原位保留在其会话键下;B 的状态为空——无需 stash/take。
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("msg1")]);
    assert.deepEqual(controller.sessionQueues.state("ses_b").items, []);
  });
});

describe("queue does not leak across sessions", () => {
  test("a queue typed in A stays out of B: B's strip is empty and nothing is sent to B", async () => {
    const { controller, recorded, sent, blocked } = switchController("ses_a", [
      message("msg1"),
    ]);

    const switching = switchSession.call(
      controller as unknown as ChatController,
      "ses_b",
    );
    blocked.resolve();
    await switching;

    // B 的队列条为空:早快照与权威快照都不带 A 的消息。
    assert.equal(recorded.length, 2);
    for (const snapshot of recorded) {
      assert.equal(snapshot.sessionId, "ses_b");
      assert.deepEqual(snapshot.queue, []);
    }
    // 不向 B 发送任何消息:B 空闲时的恢复排水无事可做。
    assert.deepEqual(sent, []);
    // A 的消息仍驻留在 A 名下的会话状态里,切回即可见。
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("msg1")]);
  });

  test("a queue action stamped B inside the switch window resolves against B's queue; A is untouched", async () => {
    // 竞态钉(issue 05 验收 6):切换 await 窗口内宿主已翻到 B,盖章 B 的
    // 队列动作按键解析到 B 的(空)队列,够不着 A 的状态。
    const { controller, blocked, resyncStarted } = switchController("ses_a", [
      message("msg1"),
    ]);

    const switching = switchSession.call(
      controller as unknown as ChatController,
      "ses_b",
    );
    await settleIntoSwitch(resyncStarted);
    assert.equal(controller.sessionId, "ses_b");

    // 窗口内的点击,带 webview 当前会话戳 B。
    await handleMessage.call(controller as unknown as ChatController, {
      kind: "forceQueued",
      id: "msg1",
      sessionID: "ses_b",
    });

    // 解析到 B 的队列:B 没有这条消息,无事可做;A 的队列原封不动。
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("msg1")]);
    assert.deepEqual(controller.sessionQueues.state("ses_b").items, []);

    blocked.resolve();
    await switching;
    // fullResync 收口后依旧:A 不受影响。
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("msg1")]);
  });
});
