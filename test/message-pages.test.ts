import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { collectAllMessages, mergeMessages, olderCursorOf } from "../src/util/messages";
import type { ListPage, MessageInfo } from "../src/opencode/types";

const user = (id: string, created: number) => ({
  type: "user" as const,
  id,
  time: { created },
  text: id,
});
const assistant = (id: string, created: number) => ({
  type: "assistant" as const,
  id,
  time: { created },
  content: [],
});

function page(data: MessageInfo[], next?: string, previous?: string): ListPage<MessageInfo> {
  return { data, cursor: { previous: previous ?? null, next: next ?? null } };
}

describe("mergeMessages", () => {
  test("backfilled older messages merge with the recent window, chronological", () => {
    const recent = [assistant("a5", 500), user("u4", 400)];
    const earlier = [user("u1", 100), assistant("a2", 200)];
    assert.deepEqual(
      mergeMessages(earlier, recent).map((m) => m.id),
      ["u1", "a2", "u4", "a5"],
    );
  });

  test("a refresh never drops already-backfilled older messages (acceptance 5)", () => {
    const loaded = [user("u1", 100), assistant("a2", 200), user("u4", 400)];
    const refreshed = [user("u4", 400), assistant("a6", 600)];
    assert.deepEqual(
      mergeMessages(loaded, refreshed).map((m) => m.id),
      ["u1", "a2", "u4", "a6"],
    );
  });

  test("the fresh page wins for the same id (server is the authority)", () => {
    const stale = [{ ...user("u1", 100), text: "stale" }];
    const fresh = [{ ...user("u1", 100), text: "fresh" }];
    const merged = mergeMessages(stale, fresh);
    assert.equal(merged.length, 1);
    assert.equal((merged[0] as { text: string }).text, "fresh");
  });

  test("does not mutate either input", () => {
    const a = [assistant("a2", 200)];
    const b = [user("u1", 100)];
    mergeMessages(a, b);
    assert.deepEqual(a.map((m) => m.id), ["a2"]);
    assert.deepEqual(b.map((m) => m.id), ["u1"]);
  });
});

describe("olderCursorOf", () => {
  test("a desc page's cursor.next continues toward older messages", () => {
    assert.equal(olderCursorOf(page([], "c-next", "c-prev")), "c-next");
  });

  test("a missing, null, or blank cursor means no earlier page", () => {
    assert.equal(olderCursorOf(page([], undefined, "c-prev")), undefined);
    assert.equal(olderCursorOf(page([], "", "c-prev")), undefined);
    assert.equal(
      olderCursorOf({ data: [], cursor: undefined as unknown as ListPage<MessageInfo>["cursor"] }),
      undefined,
    );
  });
});

describe("collectAllMessages", () => {
  test("follows cursor.next until it disappears, keeping newest-first order", async () => {
    const queries: unknown[] = [];
    const pages: ListPage<MessageInfo>[] = [
      page([assistant("a3", 300)], "c-3"),
      page([user("u2", 200)], "c-2"),
      page([user("u1", 100)], undefined),
    ];
    const collected = await collectAllMessages(async (query) => {
      queries.push(query);
      const next = pages.shift();
      assert.ok(next, "collectAllMessages must stop fetching");
      return next;
    });

    assert.deepEqual(
      collected.map((m) => m.id),
      ["a3", "u2", "u1"],
    );
    // First page carries the order; later pages follow the cursor and never
    // combine the two (the server rejects cursor + order).
    assert.deepEqual(queries[0], { order: "desc", limit: 200 });
    assert.deepEqual(queries[1], { cursor: "c-3", limit: 200 });
    assert.deepEqual(queries[2], { cursor: "c-2", limit: 200 });
    assert.equal(queries.length, 3);
  });

  test("stops when a page is empty even if it still advertises a cursor", async () => {
    const calls: number[] = [];
    const collected = await collectAllMessages(async (query) => {
      calls.push(1);
      if (calls.length === 1) {
        assert.ok(!query.cursor && query.order, "the first page carries the order");
        return page([user("u1", 100)], "c-1");
      }
      assert.ok(query.cursor && !query.order, "later pages carry the cursor alone");
      return page([], "ghost");
    });
    assert.deepEqual(collected.map((m) => m.id), ["u1"]);
    assert.equal(calls.length, 2);
  });

  test("gives up loudly instead of silently truncating when the cap is hit", async () => {
    await assert.rejects(
      () =>
        collectAllMessages(
          async () => page([assistant("a1", 1)], "c-end"),
          { maxPages: 3 },
        ),
      /did not end within 3 pages/,
    );
  });
});
