import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import { t } from "../src/util/i18n";
import { window as vscodeWindow } from "./vscode-stub";
import type { HostToWeb } from "../src/webview/protocol";
import type {
  FormInfo,
  ListPage,
  MessageInfo,
  PermissionRequest,
} from "../src/opencode/types";
import type { OpencodeClient } from "../src/opencode/client";

/**
 * 会话稳定性（session-stability 工票 01）：离开一个会话必须清它的回填
 * 历史。createSession 与两条删除路径漏调 resetLoadedHistory，旧会话滚顶
 * 回填的 earlierMessages 会经 renderableTranscript 合进新会话快照；权限/
 * 表单轮询无会话守卫，晚到的答案会落宿主态、随下一张快照以新会话的名义
 * 扇出。守卫镜像 refreshMessages 的 pollSessionCurrent 捕获-比对模式。
 */

const method = <T,>(name: string): T =>
  (ChatController.prototype as unknown as Record<string, T>)[name] as T;

const user = (id: string, created: number): MessageInfo => ({
  type: "user",
  id,
  time: { created },
  text: id,
});

const permission = (sessionID: string): PermissionRequest => ({
  id: `perm-${sessionID}`,
  sessionID,
  action: "bash",
  resources: [],
});

const form = (sessionID: string): FormInfo => ({
  id: `form-${sessionID}`,
  sessionID,
  title: "q",
  fields: [],
});

interface RecordedSnapshot {
  sessionId: string | undefined;
  messages: MessageInfo[];
  hasEarlier: boolean;
  pending: PermissionRequest[];
  forms: FormInfo[];
}

/** 断言所需的宿主字段读视图——fake 对象在运行时确有这些字段。 */
interface HostStateView {
  sessionId: string | undefined;
  earlierMessages: MessageInfo[];
  earlierCursor: string | undefined;
  hasEarlier: boolean;
  pending: PermissionRequest[];
  forms: FormInfo[];
}

function host(options: {
  sessionId?: string;
  earlierMessages?: MessageInfo[];
  earlierCursor?: string;
  hasEarlier?: boolean;
  offline?: boolean;
  client?: Partial<OpencodeClient>;
}) {
  const posted: HostToWeb[] = [];
  const snapshots: RecordedSnapshot[] = [];
  const queries: unknown[] = [];
  const client: OpencodeClient = {
    listMessages: async (_id: string, query?: unknown) => {
      queries.push(query);
      const page: ListPage<MessageInfo> = { data: [], cursor: { previous: null, next: null } };
      return page;
    },
    createSession: async () => ({
      data: { id: "ses_new", title: "New session - 2026-11-22T00:00:00.000Z" },
    }),
    pendingPermissions: async () => ({ data: [] }),
    sessionForms: async () => ({ data: [] }),
    deleteSession: async () => ({}),
    ...options.client,
  } as unknown as OpencodeClient;

  const c = {
    sessionId: options.sessionId ?? "ses_a",
    isSubagentSession: false,
    pendingAgent: undefined,
    pendingModel: undefined,
    busy: false,
    title: "t",
    agent: "build",
    model: undefined,
    messages: [] as MessageInfo[],
    earlierMessages: options.earlierMessages ?? [],
    earlierCursor: options.earlierCursor,
    hasEarlier: options.hasEarlier ?? false,
    loadingEarlier: false,
    historyEpoch: 0,
    pending: [] as PermissionRequest[],
    forms: [] as FormInfo[],
    diffs: [],
    turnCache: undefined,
    revertMessageID: undefined,
    contextTokens: undefined,
    cacheHitRate: undefined,
    sessionDirectory: undefined,
    worktree: undefined,
    parentSessionID: undefined,
    dismissed: new Map<string, string>(),
    sessionQueues: new SessionQueues(),
    sessionDismissed: new SessionDismissed(),
    liveContent: new Map<string, unknown>(),
    liveStreams: new Map<string, unknown>(),
    host: { folderPath: "H:\\ws" },
    folder: { uri: { fsPath: "H:\\ws" } },
    context: { workspaceState: { update: async () => {} } },
    storageKey: () => "test-key",
    client: () => (options.offline ? undefined : client),
    post: (message: HostToWeb) => {
      posted.push(message);
    },
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    resetStreams: () => {},
    clearSubagents: () => {},
    notify: () => {},
    stopPermissionPolling: () => {},
    discardSnapshot: () => {},
    refreshSessionMeta: async () => {},
    editors: [],
  } as Record<string, unknown>;

  // 真方法绑定：被测行为全部走真实实现，桩只补外围接缝。
  Object.assign(c, {
    stashDismissed: method<(sessionID?: string) => void>("stashDismissed").bind(c),
    loadDismissed: method<(sessionID: string) => void>("loadDismissed").bind(c),
    resetLoadedHistory: method<() => void>("resetLoadedHistory").bind(c),
    loadedTranscript: method<() => MessageInfo[]>("loadedTranscript").bind(c),
    renderableTranscript: method<() => MessageInfo[]>("renderableTranscript").bind(c),
    pollSessionCurrent: method<(id: string) => boolean>("pollSessionCurrent").bind(c),
    dropQueueState: method<(id: string | undefined) => void>("dropQueueState").bind(c),
    dropSessionState: method<(id: string | undefined) => void>("dropSessionState").bind(c),
    clearForms: method<() => void>("clearForms").bind(c),
    postSnapshot: () => {
      snapshots.push({
        sessionId: c.sessionId as string | undefined,
        messages: method<() => MessageInfo[]>("renderableTranscript").call(c),
        hasEarlier: c.hasEarlier as boolean,
        pending: [...(c.pending as PermissionRequest[])],
        forms: [...(c.forms as FormInfo[])],
      });
    },
  });

  return {
    // 读视图只暴露断言所需字段;被测真方法已 bind 到完整 fake 上。
    c: c as unknown as HostStateView,
    posted,
    snapshots,
    queries,
    createSession: method<() => Promise<string | undefined>>("createSession").bind(c),
    deleteSessionById: method<(id: string) => Promise<void>>("deleteSessionById").bind(c),
    handleEvent: method<
      (event: { type: string; data: Record<string, unknown>; location?: unknown }) => void
    >("handleEvent").bind(c),
    refreshPermissions: method<() => Promise<void>>("refreshPermissions").bind(c),
    refreshForms: method<() => Promise<void>>("refreshForms").bind(c),
    loadEarlier: method<() => Promise<void>>("loadEarlier").bind(c),
  };
}

/** 复现配方：旧会话已滚顶回填——离开它必须留下一页干净的历史状态。 */
function backfilledHost(sessionId?: string) {
  return host({
    sessionId,
    earlierMessages: [user("u1", 100), user("u2", 200)],
    earlierCursor: "c-old",
    hasEarlier: true,
  });
}

describe("createSession clears the old session's backfill", () => {
  test("a new session's first snapshot is empty even when the old session had backfill", async () => {
    const h = backfilledHost("ses_a");
    await h.createSession();

    assert.equal(h.c.sessionId, "ses_new");
    // 快照翻到干净的新会话：消息流空、无更早页。
    assert.equal(h.snapshots.length, 1);
    assert.deepEqual(h.snapshots[0]?.messages, []);
    assert.equal(h.snapshots[0]?.hasEarlier, false);
    // 回填存储与游标一并清空。
    assert.deepEqual(h.c.earlierMessages, []);
    assert.equal(h.c.earlierCursor, undefined);
    assert.equal(h.c.hasEarlier, false);
    // 残留游标不再污染新会话的 loadEarlier：无事可拉。
    await h.loadEarlier();
    assert.deepEqual(h.queries, []);
  });
});

describe("deleting the open session leaves no backfill", () => {
  test("history-row delete clears the backfilled store of the deleted session", async () => {
    vscodeWindow.warningReply = t("deleteButton");
    try {
      const h = backfilledHost("ses_a");
      await h.deleteSessionById("ses_a");

      assert.deepEqual(h.c.earlierMessages, []);
      assert.equal(h.c.earlierCursor, undefined);
      assert.equal(h.c.hasEarlier, false);
      // 面板不残留已删会话的回填消息。
      const snap = h.snapshots[h.snapshots.length - 1];
      assert.ok(snap);
      assert.equal(snap.sessionId, undefined);
      assert.deepEqual(snap.messages, []);
    } finally {
      vscodeWindow.warningReply = undefined;
    }
  });

  test("deleting another session keeps the open session's backfill", async () => {
    vscodeWindow.warningReply = t("deleteButton");
    try {
      const h = backfilledHost("ses_a");
      await h.deleteSessionById("ses_b");

      // 删的是 B：A 的回填原样保留。
      assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u1", "u2"]);
      assert.equal(h.c.hasEarlier, true);
    } finally {
      vscodeWindow.warningReply = undefined;
    }
  });

  test("session.deleted event clears the backfill of the open session", () => {
    const h = backfilledHost("ses_a");
    h.handleEvent({ type: "session.deleted", data: { sessionID: "ses_a" } });

    assert.deepEqual(h.c.earlierMessages, []);
    assert.equal(h.c.earlierCursor, undefined);
    assert.equal(h.c.hasEarlier, false);
    const snap = h.snapshots[h.snapshots.length - 1];
    assert.ok(snap);
    assert.equal(snap.sessionId, undefined);
    assert.deepEqual(snap.messages, []);
  });

  test("session.deleted for another session leaves the open backfill intact", () => {
    const h = backfilledHost("ses_a");
    h.handleEvent({ type: "session.deleted", data: { sessionID: "ses_b" } });

    assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u1", "u2"]);
    assert.equal(h.c.hasEarlier, true);
  });
});

describe("permission and form polls carry a session guard", () => {
  test("a late permissions answer from the session the user left does not land in host state", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = host({
      sessionId: "ses_a",
      client: {
        pendingPermissions: async () => {
          await gate;
          return { data: [permission("ses_a")] };
        },
      },
    });
    const poll = h.refreshPermissions();
    // 轮询在途，用户已翻到别的会话（切换或新建先落地）。
    h.c.sessionId = "ses_b";
    release();
    await poll;

    // A 的权限不落宿主态、不发 permissions 事件：B 的下一张快照不带 A 的卡。
    assert.deepEqual(h.c.pending, []);
    assert.equal(h.posted.filter((m) => m.kind === "permissions").length, 0);
  });

  test("a permissions answer for the open session still lands and posts", async () => {
    const h = host({
      sessionId: "ses_a",
      client: { pendingPermissions: async () => ({ data: [permission("ses_a")] }) },
    });
    await h.refreshPermissions();

    assert.deepEqual(h.c.pending.map((p) => p.sessionID), ["ses_a"]);
    const events = h.posted.filter((m) => m.kind === "permissions");
    assert.equal(events.length, 1);
  });

  test("a late forms answer from the session the user left does not land in host state", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = host({
      sessionId: "ses_a",
      client: {
        sessionForms: async () => {
          await gate;
          return { data: [form("ses_a")] };
        },
      },
    });
    const poll = h.refreshForms();
    h.c.sessionId = "ses_b";
    release();
    await poll;

    assert.deepEqual(h.c.forms, []);
    assert.equal(h.posted.filter((m) => m.kind === "forms").length, 0);
  });

  test("a forms answer for the open session still lands and posts", async () => {
    const h = host({
      sessionId: "ses_a",
      client: { sessionForms: async () => ({ data: [form("ses_a")] }) },
    });
    await h.refreshForms();

    assert.deepEqual(h.c.forms.map((f) => f.sessionID), ["ses_a"]);
    const events = h.posted.filter((m) => m.kind === "forms");
    assert.equal(events.length, 1);
  });
});

describe("creating feedback (spec Q10a, 工票 03)", () => {
  const creatingStates = (h: { posted: HostToWeb[] }): (boolean | undefined)[] =>
    h.posted.map((m) => (m.kind === "creatingSession" ? m.creating : undefined));

  test("createSession posts creating:true before the first await, then clears it after the flip", async () => {
    const h = backfilledHost("ses_a");
    await h.createSession();

    // 成对发送：先亮后灭，慢网下点击立即有回声。
    assert.deepEqual(creatingStates(h).filter((v) => v !== undefined), [true, false]);
    // 首条消息即反馈——在任何网络往返之前发出。
    assert.equal(h.posted[0]?.kind, "creatingSession");
  });

  test("a failed create still clears the feedback", async () => {
    const h = host({
      sessionId: "ses_a",
      client: {
        createSession: async () => {
          throw new Error("boom");
        },
      },
    });
    await h.createSession();

    assert.deepEqual(creatingStates(h).filter((v) => v !== undefined), [true, false]);
    assert.ok(h.posted.some((m) => m.kind === "error"));
  });

  test("offline stays silent: no creating feedback without a server", async () => {
    // 断连静默契约（工票 01）：横幅兜底，点 + 不发任何反馈。
    const h = host({ sessionId: "ses_a", offline: true });
    await h.createSession();

    assert.deepEqual(h.posted, []);
  });
});
