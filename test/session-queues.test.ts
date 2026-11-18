import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { SessionQueues } from "../src/webview/session-queues";
import type { QueuedMessage } from "../src/webview/protocol";

function message(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

/**
 * 队列状态只活在 SessionQueues、按会话键存(spec Q19):对外只暴露按会话的
 * 方法,方法一律交出新副本——调用方不得持有内部数组引用。
 */
describe("session queues", () => {
  test("each session reads its own state: a queue typed in A never shows up in B", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));
    queues.setPaused("ses_a", true);

    assert.deepEqual(queues.state("ses_b"), { items: [], paused: false });
    assert.deepEqual(queues.state("ses_a"), { items: [message("m1")], paused: true });
  });

  test("an emptied queue leaves no state behind", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));
    queues.remove("ses_a", "m1");

    assert.deepEqual(queues.state("ses_a"), { items: [], paused: false });
    // 条目已归一化:删除时没有可回收的附件。
    assert.equal(queues.drop("ses_a"), undefined);
  });

  test("dropping a deleted session returns its queue for attachment cleanup", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));
    queues.setPendingForce("ses_a", message("m2"));

    assert.deepEqual(queues.drop("ses_a"), {
      items: [message("m1")],
      paused: false,
      pendingForce: message("m2"),
    });
    assert.equal(queues.drop("ses_a"), undefined);
    assert.deepEqual(queues.state("ses_a"), { items: [], paused: false });
  });

  test("shift consumes the queue head in FIFO order", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));
    queues.push("ses_a", message("m2"));

    assert.deepEqual(queues.shift("ses_a"), message("m1"));
    assert.deepEqual(queues.shift("ses_a"), message("m2"));
    assert.equal(queues.shift("ses_a"), undefined);
    assert.deepEqual(queues.state("ses_a"), { items: [], paused: false });
  });

  test("unshift puts an item back at the front", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));
    queues.unshift("ses_a", message("m0"));

    assert.deepEqual(queues.shift("ses_a"), message("m0"));
  });

  test("setPaused and setPendingForce round-trip through the keyed state", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));

    queues.setPaused("ses_a", true);
    assert.equal(queues.state("ses_a").paused, true);

    queues.setPendingForce("ses_a", message("m2"));
    assert.deepEqual(queues.state("ses_a").pendingForce, message("m2"));

    // 强制消息随回合结束启动,清位后状态里不再有它。
    queues.setPendingForce("ses_a", undefined);
    assert.equal(queues.state("ses_a").pendingForce, undefined);
    assert.equal(queues.state("ses_a").paused, true);
  });

  test("a missing session id reads empty", () => {
    const queues = new SessionQueues();

    assert.deepEqual(queues.state(undefined), { items: [], paused: false });
    assert.equal(queues.drop(undefined), undefined);
  });

  test("state hands out a fresh copy, never the internal array", () => {
    const queues = new SessionQueues();
    queues.push("ses_a", message("m1"));

    const view = queues.state("ses_a");
    view.items.push(message("m2"));

    assert.deepEqual(queues.state("ses_a").items, [message("m1")]);
  });

  test("state clones pendingForce, so callers cannot rewrite the held item", () => {
    const queues = new SessionQueues();
    queues.setPendingForce("ses_a", message("m2"));

    const view = queues.state("ses_a");
    if (view.pendingForce) {
      view.pendingForce.text = "rewritten";
    }

    assert.deepEqual(queues.state("ses_a").pendingForce, message("m2"));
  });

  test("two reads of an unknown session hand out independent fresh arrays", () => {
    // 空分支必须返回全新字面量(issue 05):不得共享模块级空数组。
    const queues = new SessionQueues();

    const first = queues.state("ses_a");
    const second = queues.state("ses_b");

    first.items.push(message("m1"));

    assert.deepEqual(first, { items: [message("m1")], paused: false });
    assert.deepEqual(second, { items: [], paused: false });
  });

  test("pushing into a returned empty snapshot never affects later reads", () => {
    // 向 state 返回的空数组 push 不得影响后续读(EMPTY 别名回归钉)。
    const queues = new SessionQueues();

    const handed = queues.state("ses_a");
    handed.items.push(message("m1"));

    assert.deepEqual(queues.state("ses_a").items, []);
    assert.deepEqual(queues.state("ses_b").items, []);
  });
});
