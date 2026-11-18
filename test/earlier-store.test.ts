import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { HostToWeb } from "../src/webview/protocol";
import type { ListPage, MessageInfo } from "../src/opencode/types";
import type { OpencodeClient } from "../src/opencode/client";

/**
 * The message-page state machine: one recent window (replaced on refresh) plus
 * an append-only backfilled store (`earlierMessages`). Refreshes must never
 * drop backfilled pages, `loadEarlier` follows `cursor.next` alone (cursor +
 * order together are rejected by the server), and a changed revert point drops
 * the backfilled store because the server may have hidden those messages.
 */

const user = (id: string, created: number): MessageInfo => ({
  type: "user",
  id,
  time: { created },
  text: id,
});
const assistant = (id: string, created: number): MessageInfo => ({
  type: "assistant",
  id,
  time: { created },
  content: [],
});

function page(data: MessageInfo[], next?: string): ListPage<MessageInfo> {
  return { data, cursor: { previous: null, next: next ?? null } };
}

const method = <T,>(name: string): T =>
  (ChatController.prototype as unknown as Record<string, T>)[name] as T;

interface SessionShape {
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string };
  parentID?: string;
  revert?: { messageID?: string };
  busy?: number;
  idle?: number;
}

function controller(options: {
  messages?: MessageInfo[];
  earlierMessages?: MessageInfo[];
  earlierCursor?: string;
  hasEarlier?: boolean;
  pages: ListPage<MessageInfo>[];
  session?: SessionShape;
}) {
  const posted: HostToWeb[] = [];
  const queries: unknown[] = [];
  const session = options.session ?? {};
  const fake = {
    listMessages: async (_id: string, query?: unknown) => {
      queries.push(query);
      const next = options.pages.shift();
      if (!next) {
        throw new Error("unexpected extra listMessages call");
      }
      return next;
    },
    getSession: async () => ({
      data: {
        title: session.title ?? "t",
        agent: session.agent ?? "build",
        model: session.model,
        parentID: session.parentID,
        revert: session.revert,
        cost: 0,
        time: { created: 1, updated: 2, busy: session.busy ?? 0, idle: session.idle ?? 0 },
      },
    }),
  } as unknown as OpencodeClient;
  const c = {
    sessionId: "s1" as string | undefined,
    messages: options.messages ?? [],
    earlierMessages: options.earlierMessages ?? [],
    earlierCursor: options.earlierCursor,
    hasEarlier: options.hasEarlier ?? false,
    loadingEarlier: false,
    turnCache: undefined as
      | { sessionID: string; messages: MessageInfo[]; at: number }
      | undefined,
    revertMessageID: undefined as string | undefined,
    contextTokens: undefined,
    cacheHitRate: undefined,
    liveContent: new Map<string, unknown>(),
    liveStreams: new Map<string, unknown>(),
    client: () => fake,
    post: (m: HostToWeb) => {
      posted.push(m);
    },
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    flushDeltas: () => {},
    pruneStreams: () => {},
    refreshDiffs: async () => {},
  };
  // 真方法在内部经 this.refreshMessages() 等动态分发,必须作为桩的属性存在。
  Object.assign(c, {
    pollSessionCurrent: method<(sessionID: string) => boolean>("pollSessionCurrent").bind(c),
    refreshMessages: method<() => Promise<void>>("refreshMessages").bind(c),
    loadEarlier: method<() => Promise<void>>("loadEarlier").bind(c),
    postMessages: method<(sessionID: string) => void>("postMessages").bind(c),
    mergedMessages: method<() => MessageInfo[]>("mergedMessages").bind(c),
    allMessages: method<() => MessageInfo[]>("allMessages").bind(c),
    resetLoadedHistory: method<() => void>("resetLoadedHistory").bind(c),
  });
  return {
    c,
    posted,
    queries,
    refreshMessages: method<() => Promise<void>>("refreshMessages").bind(c),
    loadEarlier: method<() => Promise<void>>("loadEarlier").bind(c),
    postMessages: method<(sessionID: string) => void>("postMessages").bind(c),
    allMessages: method<() => MessageInfo[]>("allMessages").bind(c),
    resetLoadedHistory: method<() => void>("resetLoadedHistory").bind(c),
    refreshSessionMeta: method<() => Promise<void>>("refreshSessionMeta").bind(c),
  };
}

const messagesEvent = (posted: HostToWeb[]) =>
  posted.filter((m): m is Extract<HostToWeb, { kind: "messages" }> => m.kind === "messages");

describe("refreshMessages with history pages", () => {
  test("a refresh replaces the recent window and keeps backfilled older messages", async () => {
    const h = controller({
      messages: [user("u5", 500)],
      earlierMessages: [user("u1", 100)],
      pages: [page([assistant("a6", 600), user("u5", 500)], "c-next")],
    });
    await h.refreshMessages();

    assert.deepEqual(h.queries, [{ limit: 100, order: "desc" }]);
    assert.deepEqual(h.c.messages.map((m) => m.id), ["u5", "a6"]);
    // 验收⑤：刷新冲不掉已回填的更早消息。
    assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u1"]);
    assert.equal(h.c.hasEarlier, true);
    assert.equal(h.c.earlierCursor, "c-next");

    const [event] = messagesEvent(h.posted);
    assert.ok(event, "refresh must post a messages event");
    assert.deepEqual(event.messages.map((m) => m.id), ["u1", "u5", "a6"]);
    assert.equal(event.hasEarlier, true);
    assert.equal(event.loadingEarlier, false);
  });

  test("the transcript view folds the backfilled store with the recent window", async () => {
    const h = controller({
      messages: [user("u5", 500)],
      earlierMessages: [user("u1", 100)],
      pages: [page([])],
    });
    assert.deepEqual(h.allMessages().map((m) => m.id), ["u1", "u5"]);
  });

  test("the turn cache keeps holding the recent window only", async () => {
    const h = controller({
      messages: [user("u5", 500)],
      earlierMessages: [user("u1", 100)],
      pages: [page([assistant("a6", 600), user("u5", 500)], "c-next")],
    });
    await h.refreshMessages();
    assert.ok(h.c.turnCache);
    // Diff list inputs stay on the newest page (known limitation, issue 01) —
    // backfilled messages must not widen the attribution set or diff range.
    assert.deepEqual(h.c.turnCache.messages.map((m) => m.id), ["u5", "a6"]);
  });
});

describe("loadEarlier", () => {
  test("follows cursor.next without order, merges, and reports the flags", async () => {
    const h = controller({
      messages: [user("u5", 500)],
      earlierCursor: "c-oldest",
      hasEarlier: true,
      pages: [page([assistant("a2", 200), user("u1", 100)], "c-2"), page([])],
    });
    await h.loadEarlier();

    // cursor 与 order 互斥：回填请求只带游标。
    assert.deepEqual(h.queries[0], { cursor: "c-oldest", limit: 100 });
    assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u1", "a2"]);
    assert.equal(h.c.hasEarlier, true, "a non-empty page with a next cursor may have more");
    assert.equal(h.c.loadingEarlier, false);
    const events = messagesEvent(h.posted);
    assert.equal(events.length, 2);
    const [loading, merged] = events;
    assert.ok(loading && merged, "loadEarlier posts twice: indicator, then merged page");
    assert.equal(loading.loadingEarlier, true, "the indicator shows before the fetch");
    assert.deepEqual(merged.messages.map((m) => m.id), ["u1", "a2", "u5"]);
    assert.equal(merged.loadingEarlier, false);

    await h.loadEarlier();
    assert.deepEqual(h.queries[1], { cursor: "c-2", limit: 100 });
    assert.equal(h.c.hasEarlier, false, "an empty page closes the history");
    assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u1", "a2"]);
  });

  test("a request while one is already in flight is ignored", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = controller({
      messages: [user("u5", 500)],
      earlierCursor: "c-oldest",
      hasEarlier: true,
      pages: [],
    });
    let calls = 0;
    (h.c.client as () => OpencodeClient) = () =>
      ({
        listMessages: async () => {
          calls += 1;
          await gate;
          return page([user("u1", 100)]);
        },
      }) as unknown as OpencodeClient;

    const first = h.loadEarlier();
    await h.loadEarlier();
    release();
    await first;
    assert.equal(calls, 1);
  });

  test("skips when nothing earlier is pending, no session, or no client", async () => {
    const h = controller({ pages: [], hasEarlier: false, earlierCursor: "c" });
    await h.loadEarlier();
    assert.deepEqual(h.queries, []);

    h.c.sessionId = undefined;
    h.c.hasEarlier = true;
    await h.loadEarlier();
    assert.deepEqual(h.queries, []);
  });

  test("resetLoadedHistory clears the backfilled state", () => {
    const h = controller({
      earlierMessages: [user("u1", 100)],
      earlierCursor: "c",
      hasEarlier: true,
      pages: [],
    });
    h.c.loadingEarlier = true;
    h.resetLoadedHistory();
    assert.deepEqual(h.c.earlierMessages, []);
    assert.equal(h.c.earlierCursor, undefined);
    assert.equal(h.c.hasEarlier, false);
    assert.equal(h.c.loadingEarlier, false);
  });
});

describe("revert awareness", () => {
  test("a changed revert point drops backfilled history and refetches", async () => {
    const h = controller({
      earlierMessages: [user("u0", 50)],
      pages: [page([user("u5", 500)])],
      session: { revert: { messageID: "m9" } },
    });
    await h.refreshSessionMeta();
    assert.deepEqual(h.c.earlierMessages, []);
    assert.equal(h.c.hasEarlier, false);
    assert.deepEqual(h.queries, [{ limit: 100, order: "desc" }]);
  });

  test("an unchanged revert point keeps backfilled history", async () => {
    const h = controller({
      earlierMessages: [user("u0", 50)],
      pages: [],
      session: { revert: { messageID: "m9" } },
    });
    h.c.revertMessageID = "m9";
    await h.refreshSessionMeta();
    assert.deepEqual(h.c.earlierMessages.map((m) => m.id), ["u0"]);
    assert.deepEqual(h.queries, []);
  });
});
