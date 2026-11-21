// 会话模型时间线（spec .scratch/model-markers-jump-bottom/spec.md，2026-11-22·功能1）
// 的推导测试：会话开始用的模型与中途切换的位置,全部从消息流自带的
// model 字段推出——纯函数缝,不经 DOM。断言全部使用独立字面量,不重算实现。
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { firstAssistantModel, modelLabel, modelSwitches } from "../webview-ui/model-markers";
import { CLAUDE, GPT, CLAUDE_HIGH, user, assistant } from "./fixtures";

describe("model timeline", () => {
  test("the full name is provider/model and the variant is not part of it", () => {
    assert.equal(modelLabel(CLAUDE), "opencode/claude");
    assert.equal(modelLabel(CLAUDE_HIGH), "opencode/claude");
  });

  test("the starting model is the first assistant message's model", () => {
    assert.deepEqual(
      firstAssistantModel([user("u1"), assistant("a1", CLAUDE), assistant("a2", GPT)]),
      CLAUDE,
    );
  });

  test("no assistant model means no starting model", () => {
    assert.equal(firstAssistantModel([user("u1"), assistant("a1")]), undefined);
    assert.equal(firstAssistantModel([]), undefined);
  });

  test("a model change between replies marks the first reply of the new model", () => {
    assert.deepEqual(modelSwitches([assistant("a1", CLAUDE), assistant("a2", GPT)]), [
      { messageId: "a2", model: GPT },
    ]);
  });

  test("staying on one model marks nothing, and the first model is not a switch", () => {
    assert.deepEqual(modelSwitches([assistant("a1", CLAUDE), assistant("a2", CLAUDE)]), []);
  });

  test("switching back marks again", () => {
    assert.deepEqual(
      modelSwitches([assistant("a1", CLAUDE), assistant("a2", GPT), assistant("a3", CLAUDE)]),
      [
        { messageId: "a2", model: GPT },
        { messageId: "a3", model: CLAUDE },
      ],
    );
  });

  test("messages without a model are skipped, not treated as a switch", () => {
    assert.deepEqual(
      modelSwitches([assistant("a1", CLAUDE), assistant("a2"), assistant("a3", CLAUDE_HIGH)]),
      [],
    );
  });

  test("a variant change alone is not a switch", () => {
    assert.deepEqual(modelSwitches([assistant("a1", CLAUDE), assistant("a2", CLAUDE_HIGH)]), []);
  });
});
