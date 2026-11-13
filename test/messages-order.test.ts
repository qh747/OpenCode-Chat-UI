import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { orderMessages } from "../src/util/messages";

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

describe("orderMessages", () => {
  test("flips newest-first server order into chronological order (bug #7)", () => {
    const serverOrder = [assistant("a2", 200), user("u1", 100)];
    const ordered = orderMessages(serverOrder);
    assert.deepEqual(
      ordered.map((m) => m.id),
      ["u1", "a2"],
    );
  });

  test("orders a multi-turn conversation with meta messages interleaved", () => {
    const serverOrder = [
      assistant("a4", 400),
      { type: "idle", id: "i5", time: { created: 500 } },
      user("u3", 300),
      assistant("a2", 200),
      user("u1", 100),
    ];
    assert.deepEqual(
      orderMessages(serverOrder).map((m) => m.id),
      ["u1", "a2", "u3", "a4", "i5"],
    );
  });

  test("does not mutate the input array", () => {
    const serverOrder = [assistant("a2", 200), user("u1", 100)];
    orderMessages(serverOrder);
    assert.equal(serverOrder[0]?.id, "a2");
  });
});
