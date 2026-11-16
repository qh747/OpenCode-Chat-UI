import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { queueStripReducer } from "../webview-ui/QueueStrip";

describe("queue strip expansion rules", () => {
  test("a new queued message auto-expands the strip", () => {
    const state = queueStripReducer({ open: false }, { type: "queueChanged", length: 1, grew: true });
    assert.equal(state.open, true);
  });

  test("an emptied queue collapses the strip", () => {
    let state = queueStripReducer({ open: true }, { type: "queueChanged", length: 2, grew: true });
    state = queueStripReducer(state, { type: "queueChanged", length: 0, grew: false });
    assert.equal(state.open, false);
  });

  test("manual collapse survives queue updates that did not grow", () => {
    let state = queueStripReducer({ open: true }, { type: "queueChanged", length: 2, grew: true });
    state = queueStripReducer(state, { type: "toggle" });
    assert.equal(state.open, false);
    state = queueStripReducer(state, { type: "queueChanged", length: 2, grew: false });
    assert.equal(state.open, false);
  });

  test("switching sessions collapses the strip again", () => {
    let state = queueStripReducer({ open: false }, { type: "queueChanged", length: 1, grew: true });
    assert.equal(state.open, true);
    state = queueStripReducer(state, { type: "sessionChanged" });
    assert.equal(state.open, false);
    // 切回来后队列还在，也保持折叠——直到下一条新消息入队。
    state = queueStripReducer(state, { type: "queueChanged", length: 1, grew: false });
    assert.equal(state.open, false);
  });
});
