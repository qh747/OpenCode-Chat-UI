import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import type { QueuedMessage } from "../src/webview/protocol";

/**
 * 队列随所属会话(spec Q17-A):A 忙时排队的消息,在 A 的回合后台结束时
 * 发给 A——不管用户此刻显示的是哪个会话、该会话是否在跑。回合结束的队列
 * 处理抽为按会话参数化的 handleTurnEndQueue,前台与后台共用同一条路径;
 * 显示副作用(busy 复位、消息刷新)仍只属于当前显示的会话。
 */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

const handleEvent = (
  ChatController.prototype as unknown as {
    handleEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  }
).handleEvent;

const switchSession = (
  ChatController.prototype as unknown as {
    switchSession: (id: string) => Promise<void>;
  }
).switchSession;

function message(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

interface StartedTurn {
  sessionID: string;
  item: QueuedMessage;
}

/** A fake carrying what `handleEvent`'s turn-end paths touch. */
function turnEndController(displayed: string | undefined, busy = false) {
  const posted: Array<Record<string, unknown>> = [];
  /** 排水启动的排队消息:(目标会话, 消息) —— 「发送归属」的测试缝。 */
  const started: StartedTurn[] = [];
  const controller = {
    sessionId: displayed,
    isSubagentSession: false,
    pendingAgent: undefined,
    pendingModel: undefined,
    busy,
    turnFailed: false,
    /** 在跑回合 latch:sendNow 接受后登记、step.started 登记、回合结束消费。 */
    runningTurns: new Set<string>(),
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    dismissed: new Map<string, string>(),
    stagedImages: new Map<string, unknown>(),
    messages: [],
    pending: [],
    diffs: [],
    turnCache: undefined,
    forms: [],
    sinks: new Set<unknown>(),
    context: { workspaceState: { update: async () => {} } },
    // handleEvent 显示侧依赖:一律 stub,测试只看队列语义与发送归属。
    flushDeltas: () => {},
    settleSubagents: async () => {},
    stopPermissionPolling: () => {},
    scheduleMessagesRefresh: () => {},
    scheduleSessionMetaRefresh: () => {},
    refreshDiffs: async () => {},
    notify: () => {},
    resetStreams: () => {},
    clearForms: () => {},
    clearSubagents: () => {},
    stashDismissed: proto.stashDismissed,
    loadDismissed: proto.loadDismissed,
    storageKey: () => "test-key",
    postSnapshot: () => {},
    fullResync: async () => {},
    post(message: Record<string, unknown>) {
      posted.push(message);
    },
    startQueued(item: QueuedMessage, sessionID: string) {
      started.push({ sessionID, item });
    },
    drainQueue: proto.drainQueue,
    handleTurnEndQueue: proto.handleTurnEndQueue,
    postQueue: proto.postQueue,
    drainSwitchedQueue: proto.drainSwitchedQueue,
  };
  return { controller, posted, started };
}

describe("background turn end delivers the owning session's queue", () => {
  test("A's turn ends while B is displayed: the message goes to A, B stays quiet", () => {
    const { controller, posted, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    // A 的回合在跑(排队时 A 忙;回合由面板启动,prompt 已被接受)。
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    // 消息发给 A:队头以 A 为目标启动,队列消费一条。
    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("m1") }]);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, []);
    // B 无任何动静:没有任何以 B 为标签的消息落显示。
    for (const entry of posted) {
      assert.notEqual(entry.sessionID, "ses_b");
    }
    assert.equal(controller.busy, false);
  });

  test("switching back to A afterwards does not re-send the message", async () => {
    const { controller, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.succeeded",
      data: { sessionID: "ses_a" },
    });
    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("m1") }]);

    await switchSession.call(controller as unknown as ChatController, "ses_a");

    // 送达只发生在回合结束那一刻:切回不重复发送。
    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("m1") }]);
  });

  test("a background failed turn pauses A's queue, rules matching the foreground", () => {
    const { controller, posted, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.failed",
      data: { sessionID: "ses_a" },
    });

    // 不发送;该会话队列转为暂停(与前台失败同规则),等待用户恢复。
    assert.deepEqual(started, []);
    assert.deepEqual(controller.sessionQueues.state("ses_a"), {
      items: [message("m1")],
      paused: true,
    });
    // 暂停状态以 A 的标签广播,不触碰 B 的显示。
    for (const entry of posted) {
      assert.notEqual(entry.sessionID, "ses_b");
    }
  });

  test("an interrupted turn's pendingForce starts against its owning session", () => {
    const { controller, posted, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.sessionQueues.setPendingForce("ses_a", message("forced"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.interrupted",
      data: { sessionID: "ses_a" },
    });

    // 强制消息随所属会话走:以 A 为目标启动,pendingForce 消费,优先于暂停规则。
    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("forced") }]);
    assert.equal(controller.sessionQueues.state("ses_a").pendingForce, undefined);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("m1")]);
    assert.equal(controller.sessionQueues.state("ses_a").paused, false);
    for (const entry of posted) {
      assert.notEqual(entry.sessionID, "ses_b");
    }
  });

  test("an end-of-turn event burst drains exactly one queued message", () => {
    // 回合结束事件成簇到达(idle + execution.*):latch 消费一次即挡住
    // 同簇重复排水,否则一次切换会并发启动两条回合。
    const { controller, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.sessionQueues.push("ses_a", message("m2"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });
    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.succeeded",
      data: { sessionID: "ses_a" },
    });

    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("m1") }]);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("m2")]);
  });

  test("a turn end for a session the panel never saw running leaves its queue alone", () => {
    // latch 只登记面板确知的在跑回合:未登记会话的结束事件不排水
    // (队列属于会话,不属于事件的来看热闹者)。
    const { controller, started } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    assert.deepEqual(started, []);
    assert.deepEqual(controller.sessionQueues.state("ses_a"), {
      items: [message("m1")],
      paused: false,
    });
  });
});

describe("the displayed session's turn end still drives its own queue", () => {
  test("the foreground FIFO chain survives: idle drains the queue head", () => {
    const { controller, started } = turnEndController("ses_a", true);
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.sessionQueues.push("ses_a", message("m2"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    assert.deepEqual(started, [{ sessionID: "ses_a", item: message("m1") }]);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("m2")]);
  });
});
