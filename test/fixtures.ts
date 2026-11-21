// 跨测试文件共享的消息工厂与模型常量。本批评审（Standards 轴 #2）把
// model-markers / history-backfill / jump-bottom-pill 三处各写一份的
// user/assistant 工厂与模型常量收进这里;更早的测试文件不在本批范围。
import type { MessageInfo, ModelRef } from "../src/opencode/types";

export const CLAUDE: ModelRef = { providerID: "opencode", id: "claude" };
export const GPT: ModelRef = { providerID: "opencode", id: "gpt" };
export const CLAUDE_HIGH: ModelRef = { providerID: "opencode", id: "claude", variant: "high" };

export const user = (id: string, created = 1): MessageInfo => ({
  type: "user",
  id,
  time: { created },
  text: id,
});

export const assistant = (id: string, model?: ModelRef, text?: string): MessageInfo => ({
  type: "assistant",
  id,
  time: { created: 1 },
  content: text ? [{ type: "text", text }] : [],
  ...(model ? { model } : {}),
});
