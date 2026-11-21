import type { AssistantMessage, MessageInfo, ModelRef } from "../src/opencode/types";

/**
 * 会话的模型时间线（GLOSSARY「Model ref」）：会话开始用的模型与中途换
 * 模型的位置,全部从 assistant 消息自带的 `model` 字段推导,不依赖任何新
 * 协议字段。纯函数,便于脱离 DOM 测试。
 */

/** 完整名 providerID/modelID；思考强度（variant）不是模型的一部分,不参与。 */
export function modelLabel(model: ModelRef): string {
  return `${model.providerID}/${model.id}`;
}

/** 会话开始使用的模型:当前消息流第一条 assistant 消息携带的模型引用。 */
export function firstAssistantModel(messages: MessageInfo[]): ModelRef | undefined {
  const first = messages.find(isAssistant);
  return first?.model;
}

export interface ModelSwitch {
  /** 切换后新模型生成的第一条 assistant 消息 id——提示行插在它正上方。 */
  messageId: string;
  /** 切换到的模型。 */
  model: ModelRef;
}

/** MessageInfo 的第三个变体（{type: string; id: string}）无法用判别式排除,谓词统一收窄。 */
function isAssistant(message: MessageInfo): message is AssistantMessage {
  return message.type === "assistant";
}

/**
 * 中途换模型的位置:沿消息流逐条看 assistant 消息,与上一条「有 model 的
 * assistant 消息」相比 providerID+id 变了就记一次——切回旧模型同样记;
 * 没有 model 字段的消息跳过,不参与比较（旧会话的数据不全时不误报）。
 */
export function modelSwitches(messages: MessageInfo[]): ModelSwitch[] {
  const switches: ModelSwitch[] = [];
  let previous: ModelRef | undefined;
  for (const message of messages) {
    if (!isAssistant(message)) {
      continue;
    }
    const model = message.model;
    if (!model) {
      continue;
    }
    if (previous && !(previous.providerID === model.providerID && previous.id === model.id)) {
      switches.push({ messageId: message.id, model });
    }
    previous = model;
  }
  return switches;
}
