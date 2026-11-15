import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { cacheHitRate, cacheHitRateOf, contextTokensOf } from "../src/util/tokens";

const tokens = (input: number, read = 0) => ({
  input,
  output: 10,
  reasoning: 5,
  cache: { read, write: 0 },
});
const user = (id: string, created: number) => ({
  type: "user" as const,
  id,
  time: { created },
  text: id,
});
const assistant = (id: string, created: number, usage?: ReturnType<typeof tokens>) => ({
  type: "assistant" as const,
  id,
  time: { created },
  content: [],
  ...(usage ? { tokens: usage } : {}),
});
const compaction = (id: string, created: number, status: string) => ({
  type: "compaction",
  id,
  status,
  time: { created },
});

/** Chronological (oldest-first) lists, as produced by orderMessages. */
describe("contextTokensOf", () => {
  test("returns the latest assistant usage, not the cumulative sum", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      user("u2", 300),
      assistant("a2", 400, tokens(200, 2000)),
    ];
    // Cumulative would be 3310; the gauge must show the latest turn only.
    assert.equal(contextTokensOf(messages), 200 + 10 + 5 + 2000);
  });

  test("skips assistant messages that have not reported tokens yet", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      user("u2", 300),
      assistant("a2", 400), // in-flight or errored: no usage
    ];
    assert.equal(contextTokensOf(messages), 100 + 10 + 5 + 1000);
  });

  test("ignores usage up to the latest completed compaction", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      compaction("c1", 300, "completed"),
      assistant("a2", 400, tokens(200, 2000)),
    ];
    assert.equal(contextTokensOf(messages), 200 + 10 + 5 + 2000);
  });

  test("a pending compaction does not hide the following usage", () => {
    const messages = [
      compaction("c1", 300, "pending"),
      assistant("a1", 400, tokens(200, 2000)),
    ];
    assert.equal(contextTokensOf(messages), 200 + 10 + 5 + 2000);
  });

  test("stops at the revert point when one is set", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      user("u2", 300),
      assistant("a2", 400, tokens(200, 2000)),
    ];
    assert.equal(contextTokensOf(messages, "u2"), 100 + 10 + 5 + 1000);
  });

  test("an unknown revert point yields no gauge value", () => {
    const messages = [user("u1", 100), assistant("a1", 200, tokens(100, 1000))];
    assert.equal(contextTokensOf(messages, "missing"), undefined);
  });

  test("no billed assistant message means no gauge value", () => {
    assert.equal(contextTokensOf([user("u1", 100)]), undefined);
    assert.equal(contextTokensOf([]), undefined);
  });
});

/** Cache hit rate = cache.read / (input + cache.read), from the same message the gauge reads. */
describe("cacheHitRate", () => {
  test("is the cached share of prompt tokens", () => {
    assert.equal(cacheHitRate(tokens(100, 1000)), 1000 / 1100);
  });

  test("cache.write does not enter the denominator", () => {
    assert.equal(cacheHitRate({ input: 100, output: 0, reasoning: 0, cache: { read: 900, write: 50 } }), 900 / 1000);
  });

  test("all-cached prompt is 1", () => {
    assert.equal(cacheHitRate(tokens(0, 500)), 1);
  });

  test("no prompt tokens means no rate", () => {
    assert.equal(cacheHitRate(tokens(0, 0)), undefined);
  });
});

describe("cacheHitRateOf", () => {
  test("reads the latest billed assistant message", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      user("u2", 300),
      assistant("a2", 400, tokens(200, 2000)),
    ];
    assert.equal(cacheHitRateOf(messages), 2000 / 2200);
  });

  test("follows the same revert boundary as the gauge", () => {
    const messages = [
      user("u1", 100),
      assistant("a1", 200, tokens(100, 1000)),
      user("u2", 300),
      assistant("a2", 400, tokens(200, 2000)),
    ];
    assert.equal(cacheHitRateOf(messages, "u2"), 1000 / 1100);
  });

  test("no billed assistant message means no rate", () => {
    assert.equal(cacheHitRateOf([user("u1", 100)]), undefined);
    assert.equal(cacheHitRateOf([], undefined), undefined);
  });
});
