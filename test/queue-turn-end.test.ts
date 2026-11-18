import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import type { AttachmentRef, QueuedMessage } from "../src/webview/protocol";

/**
 * 队列随所属会话(spec Q17-A):A 忙时排队的消息,在 A 的回合后台结束时
 * 发给 A——不管用户此刻显示的是哪个会话、该会话是否在跑。回合结束的队列
 * 处理抽为按会话参数化的 handleTurnEndQueue,前台与后台共用同一条路径;
 * 显示副作用(busy 复位、消息刷新)仍只属于当前显示的会话。
 *
 * 测试缝走真边界:只 stub client.prompt(「发送归属」的实际落点),
 * sendNow/startQueued/drainQueue/handleTurnEndQueue 全用真实现——此前缝在
 * startQueued 上,sendNow 从未在后台路径跑过,sendNow 的显示态断言
 * (busy/转录/轮询)是空的,测不出泄漏。
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

const send = (
  ChatController.prototype as unknown as {
    send: (text: string, attachments: AttachmentRef[]) => Promise<void>;
  }
).send;

function message(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

/** The methods the turn-end → queue → send chain touches, plus the prompt seam. */
function turnEndController(displayed: string | undefined, busy = false) {
  const posted: Array<Record<string, unknown>> = [];
  /** client.prompt 的调用:(目标会话, 提示正文, 附件) —— 「发送归属」的测试缝。 */
  const prompted: Array<{
    sessionID: string;
    text: string;
    files: Array<Record<string, unknown>>;
  }> = [];
  /** 显示侧轮询的启动记录(权限/子代理)。 */
  const polls: string[] = [];
  /** host 级「最近使用的模型」记录(喂给显示会话 picker 的 Recent)。 */
  const recordedModels: unknown[] = [];
  const model = { providerID: "prov", id: "model" };
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
    earlierMessages: [],
    earlierCursor: undefined,
    hasEarlier: false,
    loadingEarlier: false,
    pending: [],
    diffs: [],
    turnCache: undefined,
    forms: [],
    model,
    liveContent: new Map<string, never>(),
    liveStreams: new Map<string, never>(),
    sinks: new Set<unknown>(),
    context: { workspaceState: { update: async () => {} } },
    host: {
      catalog: { defaultModel: undefined },
      recordModelUsed(used: unknown) {
        recordedModels.push(used);
      },
    },
    client: () => ({
      prompt: async (
        sessionID: string,
        body: { text: string; files: Array<Record<string, unknown>> },
      ) => {
        prompted.push({ sessionID, text: body.text, files: body.files });
        return {};
      },
    }),
    // 用户此刻的编辑器选区属于显示会话的上下文(真实实现读 activeTextEditor)。
    activeSelection: () => ({ path: "/ws/b.md", start: 1, end: 2 }),
    toPromptAttachment: proto.toPromptAttachment,
    selectionAttachment: proto.selectionAttachment,
    mergedMessages: proto.mergedMessages,
    allMessages: proto.allMessages,
    // handleEvent 显示侧依赖:一律 stub,测试只看队列语义、发送归属与显示态。
    flushDeltas: () => {},
    settleSubagents: async () => {},
    stopPermissionPolling: () => {},
    startPermissionPolling() {
      polls.push("permission");
    },
    startSubagentPolling() {
      polls.push("subagent");
    },
    scheduleMessagesRefresh: () => {},
    scheduleSessionMetaRefresh: () => {},
    refreshDiffs: async () => {},
    notify: () => {},
    resetStreams: () => {},
    clearForms: () => {},
    clearSubagents: () => {},
    stashDismissed: proto.stashDismissed,
    loadDismissed: proto.loadDismissed,
    resetLoadedHistory: () => {},
    storageKey: () => "test-key",
    postSnapshot: () => {},
    fullResync: async () => {},
    post(message: Record<string, unknown>) {
      posted.push(message);
    },
    // 排水链走真实现:handleTurnEndQueue → drainQueue → startQueued → sendNow → prompt。
    sendNow: proto.sendNow,
    startQueued: proto.startQueued,
    drainQueue: proto.drainQueue,
    handleTurnEndQueue: proto.handleTurnEndQueue,
    postQueue: proto.postQueue,
  };
  return { controller, posted, prompted, polls, recordedModels };
}

describe("background turn end delivers the owning session's queue", () => {
  test("A's turn ends while B is displayed: the message goes to A, B stays quiet", () => {
    const { controller, posted, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    // A 的回合在跑(排队时 A 忙;回合由面板启动,prompt 已被接受)。
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    // 消息发给 A:prompt 以 A 为目标启动,队列消费一条(真 sendNow 路径)。
    // 正文不带 B 的选区——选区属于显示会话的用户上下文,不随后台回合捎带。
    assert.deepEqual(prompted, [{ sessionID: "ses_a", text: "m1", files: [] }]);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, []);
    // B 无任何动静:没有任何以 B 为标签的消息落显示。
    for (const entry of posted) {
      assert.notEqual(entry.sessionID, "ses_b");
    }
    assert.equal(controller.busy, false);
  });

  test("switching back to A afterwards does not re-send the message", async () => {
    const { controller, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.succeeded",
      data: { sessionID: "ses_a" },
    });
    assert.deepEqual(
      prompted.map((entry) => entry.sessionID),
      ["ses_a"],
    );

    await switchSession.call(controller as unknown as ChatController, "ses_a");

    // 送达只发生在回合结束那一刻:切回不重复发送。
    assert.deepEqual(
      prompted.map((entry) => entry.sessionID),
      ["ses_a"],
    );
  });

  test("a background failed turn pauses A's queue, rules matching the foreground", () => {
    const { controller, posted, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.failed",
      data: { sessionID: "ses_a" },
    });

    // 不发送;该会话队列转为暂停(与前台失败同规则),等待用户恢复。
    assert.deepEqual(prompted, []);
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
    const { controller, posted, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.sessionQueues.setPendingForce("ses_a", message("forced"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.execution.interrupted",
      data: { sessionID: "ses_a" },
    });

    // 强制消息随所属会话走:以 A 为目标启动,pendingForce 消费,优先于暂停规则。
    assert.deepEqual(
      prompted.map((entry) => ({ sessionID: entry.sessionID, text: entry.text })),
      [{ sessionID: "ses_a", text: "forced" }],
    );
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
    const { controller, prompted } = turnEndController("ses_b");
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

    assert.deepEqual(
      prompted.map((entry) => ({ sessionID: entry.sessionID, text: entry.text })),
      [{ sessionID: "ses_a", text: "m1" }],
    );
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("m2")]);
  });

  test("a turn end for a session the panel never saw running leaves its queue alone", () => {
    // latch 只登记面板确知的在跑回合:未登记会话的结束事件不排水
    // (队列属于会话,不属于事件的来看热闹者)。
    const { controller, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    assert.deepEqual(prompted, []);
    assert.deepEqual(controller.sessionQueues.state("ses_a"), {
      items: [message("m1")],
      paused: false,
    });
  });
});

describe("the displayed session's turn end still drives its own queue", () => {
  test("the foreground FIFO chain survives: idle drains the queue head", () => {
    const { controller, prompted, recordedModels } = turnEndController("ses_a", true);
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.sessionQueues.push("ses_a", message("m2"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    // 前台排水也走真 sendNow:prompt 以显示会话为目标;选区随自己的回合
    // 捎带(auto-attach 属于显示会话的用户上下文);picker 的 Recent 记录
    // 自己的模型选择。
    assert.deepEqual(prompted, [
      {
        sessionID: "ses_a",
        text: "m1",
        files: [{ uri: "file:///ws/b.md?start=1&end=2", name: "b.md", description: "L1-L2" }],
      },
    ]);
    assert.deepEqual(controller.sessionQueues.state("ses_a").items, [message("m2")]);
    assert.deepEqual(recordedModels, [{ providerID: "prov", id: "model" }]);
  });
});

describe("a background delivery leaves the displayed session alone", () => {
  test("a background delivery while another session is displayed leaves the displayed session idle and clean", () => {
    const { controller, prompted, polls, recordedModels } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });

    // 发送归属不变:回合以 A 为目标启动,正文不带 B 的选区上下文。
    assert.deepEqual(prompted, [{ sessionID: "ses_a", text: "m1", files: [] }]);
    // B 的显示态纹丝不动:busy 锁不被后台回合占用、转录不混入 A 的气泡、
    // 为 B 服务的轮询不被拉起、picker 的 Recent 不被写入。
    assert.equal(controller.busy, false);
    assert.equal(controller.turnFailed, false);
    assert.deepEqual(controller.messages, []);
    assert.deepEqual(polls, []);
    assert.deepEqual(recordedModels, []);
  });

  test("the user can still send immediately in the displayed session after a background delivery", async () => {
    const { controller, prompted } = turnEndController("ses_b");
    controller.sessionQueues.push("ses_a", message("m1"));
    controller.runningTurns.add("ses_a");

    // A 的回合在后台结束,B 空闲:用户此刻在 B 发的消息必须直接成为回合,
    // 不被 busy 锁扣进 B 的队列(锁若被后台回合占用,B 没有回合在跑、
    // 永远等不到排水,下一条消息就卡死在条里)。
    handleEvent.call(controller as unknown as ChatController, {
      type: "session.idle",
      data: { sessionID: "ses_a" },
    });
    await send.call(controller as unknown as ChatController, "hello from B", []);

    assert.deepEqual(
      prompted.map((entry) => ({ sessionID: entry.sessionID, text: entry.text })),
      [
        { sessionID: "ses_a", text: "m1" },
        { sessionID: "ses_b", text: "hello from B" },
      ],
    );
    assert.deepEqual(controller.sessionQueues.state("ses_b").items, []);
    // B 自己的回合正常置位 busy:锁重新属于 B 的前台回合。
    assert.equal(controller.busy, true);
  });
});
