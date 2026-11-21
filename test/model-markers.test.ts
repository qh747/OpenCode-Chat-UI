// 会话模型时间线（spec 2025-11 规划·功能1）的推导测试：会话开始用的
// 模型与中途切换的位置,全部从消息流自带的 model 字段推出——纯函数缝,
// 不经 DOM。断言全部使用独立字面量,不重算实现。
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { firstAssistantModel, modelLabel, modelSwitches } from "../webview-ui/model-markers";
import type { MessageInfo, ModelRef } from "../src/opencode/types";

const CLAUDE: ModelRef = { providerID: "opencode", id: "claude" };
const GPT: ModelRef = { providerID: "opencode", id: "gpt" };
const CLAUDE_HIGH: ModelRef = { providerID: "opencode", id: "claude", variant: "high" };

const user = (id: string): MessageInfo => ({ type: "user", id, time: { created: 1 }, text: id });
const assistant = (id: string, model?: ModelRef): MessageInfo => ({
  type: "assistant",
  id,
  time: { created: 1 },
  content: [],
  ...(model ? { model } : {}),
});

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
