import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";

/**
 * `refreshSessionMeta` is the only place that re-derives the controller's
 * global `busy` flag from the server, and it runs on every switch-back. The
 * server's `time.busy`/`time.idle` are persistent epoch timestamps, so
 * "running" is a comparison (`busy > idle`), never the presence of one and
 * absence of the other — a session that has ever finished a turn keeps its
 * old `idle` timestamp forever (issue 03, ADR-0009).
 */
const refreshSessionMeta = (
  ChatController.prototype as unknown as {
    refreshSessionMeta: () => Promise<void>;
  }
).refreshSessionMeta;

interface SessionData {
  title: string;
  agent?: string;
  model?: unknown;
  parentID?: string;
  revert?: { messageID?: string };
  time: { busy?: number; idle?: number; created?: number; updated?: number };
  cost?: number;
}

interface PostedMeta {
  kind: string;
  busy?: boolean;
  parentSessionID?: string;
}

function metaController(sessionID: string, data: SessionData) {
  const posted: PostedMeta[] = [];
  const controller = {
    sessionId: sessionID,
    title: undefined as string | undefined,
    agent: undefined as string | undefined,
    model: undefined,
    isSubagentSession: false,
    parentSessionID: undefined as string | undefined,
    revertMessageID: undefined,
    busy: undefined as unknown as boolean,
    contextTokens: undefined,
    cacheHitRate: undefined,
    posted,
    client: () => ({
      getSession: async (_id: string) => ({ data }),
    }),
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    post(message: PostedMeta) {
      posted.push(message);
    },
  };
  return controller;
}

function run(controller: ReturnType<typeof metaController>): Promise<void> {
  return refreshSessionMeta.call(controller as unknown as ChatController);
}

describe("session meta busy predicate", () => {
  test("a busy timestamp newer than the idle one means running", async () => {
    // A finished turn left idle=2000 behind; the new turn set busy=3000.
    const controller = metaController("ses_a", { title: "T", time: { busy: 3000, idle: 2000 } });

    await run(controller);

    assert.equal(controller.busy, true);
    assert.equal(
      controller.posted.some((message) => message.kind === "sessionMeta" && message.busy === true),
      true,
    );
  });

  test("a stale idle timestamp means idle, not running", async () => {
    // The formula this replaces treated `!time.idle` as "not busy", which is
    // false forever for any session that has ever completed a turn.
    const controller = metaController("ses_a", { title: "T", time: { busy: 1000, idle: 2000 } });

    await run(controller);

    assert.equal(controller.busy, false);
    assert.equal(
      controller.posted.some((message) => message.kind === "sessionMeta" && message.busy === false),
      true,
    );
  });

  test("a session that never ran is idle", async () => {
    const controller = metaController("ses_a", { title: "T", time: {} });

    await run(controller);

    assert.equal(controller.busy, false);
  });
});

describe("session meta ships the parent id (subagent-nav)", () => {
  test("a child session posts its parent id for the back button", async () => {
    const controller = metaController("ses_c", { title: "C", parentID: "ses_p", time: {} });

    await run(controller);

    const meta = controller.posted.find((message) => message.kind === "sessionMeta");
    assert.equal(meta?.parentSessionID, "ses_p");
  });

  test("a root session posts no parent id", async () => {
    const controller = metaController("ses_r", { title: "R", time: {} });

    await run(controller);

    const meta = controller.posted.find((message) => message.kind === "sessionMeta");
    assert.equal(meta?.parentSessionID, undefined);
  });
});
