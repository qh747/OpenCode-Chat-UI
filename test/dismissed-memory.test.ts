import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import type { FileDiffInfo } from "../src/opencode/types";
import { t } from "../src/util/i18n";
import { window } from "./vscode-stub";

/**
 * 撤销（revertFile → dismiss）在 panel 全局 Map 里记下行签名，但 switchSession
 * 一刀 clear()：切走即失忆，切回后服务器把同签名的历史 diff 原样吐回 → 幽灵行
 * 复活（spec Q10）。dismissed 必须按会话泊位：切走 stash、回来 take；删除会话
 * 时把该会话的驻留记忆一并清掉。键统一走 diffFileKey 归一化（两套键 → 一套）。
 */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

const switchSession = (
  ChatController.prototype as unknown as {
    switchSession: (id: string) => Promise<void>;
  }
).switchSession;

const dismiss = (
  ChatController.prototype as unknown as {
    dismiss: (file: string) => void;
  }
).dismiss;

const visibleDiffs = (
  ChatController.prototype as unknown as {
    visibleDiffs: () => FileDiffInfo[];
  }
).visibleDiffs;

const deleteSessionById = (
  ChatController.prototype as unknown as {
    deleteSessionById: (id: string) => Promise<void>;
  }
).deleteSessionById;

const handleEvent = (
  ChatController.prototype as unknown as {
    handleEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  }
).handleEvent;

/** 两个不同签名（status:additions:deletions）的同文件 diff。 */
function diffOf(file: string, additions: number): FileDiffInfo {
  return { file, status: "modified", additions, deletions: 0, patch: "" };
}

/** The prototype methods the real `switchSession` delegates to. */
function switchController(from: string, diffs: FileDiffInfo[]) {
  const controller = {
    sessionId: from,
    isSubagentSession: false,
    pendingAgent: undefined,
    pendingModel: undefined,
    busy: false,
    messages: [],
    pending: [],
    diffs,
    turnCache: undefined,
    dismissed: new Map<string, string>(),
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    context: { workspaceState: { update: async () => {} } },
    resetStreams: () => {},
    clearForms: () => {},
    clearSubagents: () => {},
    stashDismissed: proto.stashDismissed,
    loadDismissed: proto.loadDismissed,
    storageKey: () => "test-key",
    postSnapshot: () => {},
    fullResync: async () => {},
    drainSwitchedQueue: () => {},
  };
  return controller;
}

/** The prototype methods the real `deleteSessionById` delegates to. */
function deleteController(current: string) {
  const controller = {
    sessionId: current,
    messages: [],
    pending: [],
    diffs: [],
    turnCache: undefined,
    busy: false,
    dismissed: new Map<string, string>(),
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    stagedImages: new Map<string, unknown>(),
    client: () => ({ deleteSession: async () => {} }),
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    dropQueueState: proto.dropQueueState,
    clearForms: () => {},
    storageKey: () => "test-key",
    postSnapshot: () => {},
    context: { workspaceState: { update: async () => {} } },
  };
  return controller;
}

/** The prototype methods the real `handleEvent` delegates to. */
function eventController(current: string) {
  const controller = {
    sessionId: current,
    messages: [],
    pending: [],
    diffs: [],
    turnCache: undefined,
    busy: false,
    dismissed: new Map<string, string>(),
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    stagedImages: new Map<string, unknown>(),
    dropQueueState: proto.dropQueueState,
    clearForms: () => {},
    resetStreams: () => {},
    clearSubagents: () => {},
    storageKey: () => "test-key",
    postSnapshot: () => {},
    context: { workspaceState: { update: async () => {} } },
  };
  return controller;
}

describe("session dismissed memory", () => {
  test("memory stashed in one session is restored when switching back", () => {
    const memory = new SessionDismissed();
    const parked = new Map([["a.md", "modified:1:0"]]);
    memory.stash("ses_a", parked);

    assert.deepEqual(memory.take("ses_b"), new Map());
    assert.deepEqual(memory.take("ses_a"), parked);
  });

  test("an empty map removes the parked entry", () => {
    const memory = new SessionDismissed();
    memory.stash("ses_a", new Map([["a.md", "modified:1:0"]]));
    memory.stash("ses_a", new Map());

    assert.deepEqual(memory.take("ses_a"), new Map());
  });

  test("take consumes the parked entry", () => {
    const memory = new SessionDismissed();
    memory.stash("ses_a", new Map([["a.md", "modified:1:0"]]));

    memory.take("ses_a");

    assert.deepEqual(memory.take("ses_a"), new Map());
  });

  test("drop erases a deleted session's parked memory", () => {
    const memory = new SessionDismissed();
    memory.stash("ses_a", new Map([["a.md", "modified:1:0"]]));

    memory.drop("ses_a");
    memory.drop("ses_b");

    assert.deepEqual(memory.take("ses_a"), new Map());
  });

  test("a missing session id is ignored", () => {
    const memory = new SessionDismissed();
    memory.stash(undefined, new Map([["a.md", "modified:1:0"]]));

    assert.deepEqual(memory.take(undefined), new Map());
    memory.drop(undefined);
  });

  test("stash hands out an independent copy, not the live map", () => {
    // 精神分裂窗口内的 dismiss 只改 live map：驻留副本必须与它脱钩。
    const memory = new SessionDismissed();
    const live = new Map([["a.md", "modified:1:0"]]);
    memory.stash("ses_a", live);

    live.set("b.md", "modified:2:0");

    assert.deepEqual(memory.take("ses_a"), new Map([["a.md", "modified:1:0"]]));
  });
});

describe("dismissed rows across switches", () => {
  test("a reverted file stays hidden when the user switches away and back", async () => {
    const controller = switchController("ses_a", [diffOf("a.md", 1)]);
    // revertFile 成功后 dismiss 记下该行签名：撤销完成，不再有待处理差异。
    dismiss.call(controller as unknown as ChatController, "a.md");

    await switchSession.call(controller as unknown as ChatController, "ses_b");
    await switchSession.call(controller as unknown as ChatController, "ses_a");
    // 切回后 refreshDiffs 重取服务器历史 diff（不可变，原样吐回）——幽灵行的
    // 来源；此后行必须仍被签名记忆压住。
    controller.diffs = [diffOf("a.md", 1)];

    // 行不复活：签名记忆跨切换存活。
    assert.deepEqual(visibleDiffs.call(controller as unknown as ChatController), []);
  });

  test("a changed signature on the same file comes back after the switch", async () => {
    // Q6 回归护栏：签名变化即新一轮变动，是新闻——必须重现。
    const controller = switchController("ses_a", [diffOf("a.md", 1)]);
    dismiss.call(controller as unknown as ChatController, "a.md");

    await switchSession.call(controller as unknown as ChatController, "ses_b");
    await switchSession.call(controller as unknown as ChatController, "ses_a");
    // 服务器重取到同文件的新一轮 diff（签名变了）——这是新闻，必须重现。
    controller.diffs = [diffOf("a.md", 2)];
    assert.deepEqual(visibleDiffs.call(controller as unknown as ChatController), [
      diffOf("a.md", 2),
    ]);
  });
});

describe("deleting a session clears its dismissed memory", () => {
  test("deleting the session the user is in clears its live memory", async () => {
    window.warningReply = t("deleteButton");
    const controller = deleteController("ses_a");
    controller.dismissed.set("a.md", "modified:1:0");

    await deleteSessionById.call(controller as unknown as ChatController, "ses_a");

    assert.equal(controller.dismissed.size, 0);
    window.warningReply = undefined;
  });

  test("deleting another session clears its parked memory", async () => {
    window.warningReply = t("deleteButton");
    const controller = deleteController("ses_b");
    // A 的记忆正驻留（用户从 A 切到 B 时泊出）；A 被删 → 驻留不得残留。
    controller.sessionDismissed.stash("ses_a", new Map([["a.md", "modified:1:0"]]));

    await deleteSessionById.call(controller as unknown as ChatController, "ses_a");

    assert.deepEqual(controller.sessionDismissed.take("ses_a"), new Map());
    window.warningReply = undefined;
  });
});

describe("session.deleted events clear dismissed memory", () => {
  test("deleting the current session clears its live memory", () => {
    const controller = eventController("ses_a");
    controller.dismissed.set("a.md", "modified:1:0");

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.deleted",
      data: { sessionID: "ses_a" },
    });

    assert.equal(controller.dismissed.size, 0);
  });

  test("deleting another session clears its parked memory", () => {
    const controller = eventController("ses_b");
    controller.sessionDismissed.stash("ses_a", new Map([["a.md", "modified:1:0"]]));

    handleEvent.call(controller as unknown as ChatController, {
      type: "session.deleted",
      data: { sessionID: "ses_a" },
    });

    assert.deepEqual(controller.sessionDismissed.take("ses_a"), new Map());
  });
});

describe("dismissed keys are normalized", () => {
  test("a backslash path dismisses the forward-slash diff of the same file", () => {
    // 服务器路径带工作树分隔符；两套键曾让同一路径对不上（spec 事实）。
    const controller = {
      diffs: [diffOf("sub/dir/a.md", 1)],
      dismissed: new Map<string, string>(),
    };

    dismiss.call(controller as unknown as ChatController, "sub\\dir\\a.md");

    assert.deepEqual(visibleDiffs.call(controller as unknown as ChatController), []);
  });
});
