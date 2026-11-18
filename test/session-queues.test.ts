import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { SessionQueues } from "../src/webview/session-queues";
import type { QueuedMessage } from "../src/webview/protocol";

function message(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

describe("session queues", () => {
  test("a queue stashed in one session is restored when switching back", () => {
    const queues = new SessionQueues();
    const items = [message("m1"), message("m2")];
    queues.stash("ses_a", { items, paused: true, pendingForce: message("m3") });

    assert.deepEqual(queues.take("ses_b"), { items: [], paused: false });
    assert.deepEqual(queues.take("ses_a"), { items, paused: true, pendingForce: message("m3") });
  });

  test("an empty queue removes the stashed entry", () => {
    const queues = new SessionQueues();
    queues.stash("ses_a", { items: [message("m1")], paused: false });
    queues.stash("ses_a", { items: [], paused: false });
    assert.deepEqual(queues.take("ses_a"), { items: [], paused: false });
  });

  test("dropping a deleted session returns its queue for attachment cleanup", () => {
    const queues = new SessionQueues();
    queues.stash("ses_a", { items: [message("m1")], paused: false });
    assert.deepEqual(queues.drop("ses_a"), { items: [message("m1")], paused: false });
    assert.equal(queues.drop("ses_a"), undefined);
    assert.deepEqual(queues.take("ses_a"), { items: [], paused: false });
  });

  test("take removes the parked snapshot", () => {
    // 一次切换只消费一次驻留：离开会 stash、回来会 take，不存在重复取。
    const queues = new SessionQueues();
    queues.stash("ses_a", { items: [message("m1")], paused: false });

    queues.take("ses_a");

    assert.deepEqual(queues.take("ses_a"), { items: [], paused: false });
  });

  test("take hands out an independent copy, not the parked array", () => {
    const queues = new SessionQueues();
    const items = [message("m1")];
    queues.stash("ses_a", { items, paused: false });

    const taken = queues.take("ses_a");
    taken.items.push(message("m2"));

    assert.deepEqual(items, [message("m1")]);
  });

  test("stash snapshots the live queue, so later pushes never leak into the park", () => {
    // 精神分裂窗口内的排队只改 live 数组：驻留快照必须与它脱钩。
    const queues = new SessionQueues();
    const items = [message("m1")];
    queues.stash("ses_a", { items, paused: false });

    items.push(message("m2"));

    assert.deepEqual(queues.take("ses_a").items, [message("m1")]);
  });
});
