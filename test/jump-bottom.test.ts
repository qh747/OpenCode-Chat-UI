// 「回到底部」胶囊（spec .scratch/model-markers-jump-bottom/spec.md，2026-11-22·功能2）
// 的判定测试：到底检测与滚轮累计——纯函数缝,不经 DOM。
// 断言全部使用独立字面量,不重算实现。
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { isAtBottom, JUMP_WHEEL_DELTA, updateJumpWheel } from "../webview-ui/jump-bottom";

describe("at-bottom detection", () => {
  test("within one threshold of the bottom counts as at the bottom", () => {
    // 距底 0px 与 39px 都算到底；阈值本身（40px）不算。
    assert.equal(isAtBottom({ scrollTop: 960, scrollHeight: 1000, clientHeight: 40 }), true);
    assert.equal(isAtBottom({ scrollTop: 921, scrollHeight: 1000, clientHeight: 40 }), true);
    assert.equal(isAtBottom({ scrollTop: 920, scrollHeight: 1000, clientHeight: 40 }), false);
  });

  test("away from the bottom is not at the bottom", () => {
    assert.equal(isAtBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 40 }), false);
  });
});

describe("wheel accumulation for the jump-to-bottom pill", () => {
  test("two notches of downward wheel surface the pill", () => {
    const first = updateJumpWheel({ delta: 0, show: false }, 120, false);
    assert.equal(first.show, false, "one notch is not enough");
    const second = updateJumpWheel(first, 120, false);
    assert.equal(second.show, true, "the second notch crosses the threshold");
    assert.equal(second.delta, 240);
  });

  test("less than the threshold never shows the pill", () => {
    const state = updateJumpWheel({ delta: 0, show: false }, JUMP_WHEEL_DELTA - 1, false);
    assert.equal(state.show, false);
  });

  test("an upward wheel resets the count but keeps a pill that is already shown", () => {
    const shown = updateJumpWheel({ delta: 0, show: false }, 240, false);
    assert.equal(shown.show, true);
    const afterUp = updateJumpWheel(shown, -120, false);
    assert.deepEqual(afterUp, { delta: 0, show: true });
  });

  test("reaching the bottom clears the count and hides the pill", () => {
    assert.deepEqual(updateJumpWheel({ delta: 120, show: false }, 120, true), {
      delta: 0,
      show: false,
    });
    assert.deepEqual(updateJumpWheel({ delta: 0, show: true }, -50, true), {
      delta: 0,
      show: false,
    });
  });

  test("wheeling down while already at the bottom never counts", () => {
    const state = updateJumpWheel({ delta: 0, show: false }, 120, true);
    assert.deepEqual(state, { delta: 0, show: false });
  });
});
