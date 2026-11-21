import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { ChatController } from "../src/webview/panel";
import { type StagedImage } from "../src/util/attachments";
import type { AttachmentRef } from "../src/webview/protocol";
import type { UserMessage } from "../src/opencode/types";

/**
 * 附件行"等很久才显示"的修复(问题 1):乐观占位气泡必须自带 files,
 * 发送瞬间就渲染附件行,不再干等权威刷新。占位形状与服务器存储对齐
 * (见 attachment-rows.test.ts 的实捕样本),权威消息替换上来时不闪变。
 */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

const sendNow = proto.sendNow as (
  text: string,
  attachments: AttachmentRef[],
  sessionID: string,
) => Promise<void>;

/** 权威 user 消息:服务器在 /prompt 周期内入库的实捕形状(带 files)。 */
const serverUserMessage: UserMessage = {
  type: "user",
  id: "msg_1",
  time: { created: 1730000001000 },
  text: "看看这张图",
  files: [{ data: "QUJD", mime: "image/png", source: { type: "inline" }, name: "shot.png" }],
};

/** A controller carrying only what `sendNow` touches (diff-send-memory 同款). */
function sendControllerWith(stagedImages: Map<string, StagedImage>) {
  const posted: Array<Record<string, unknown>> = [];
  const controller = {
    sessionId: "ses_a",
    busy: false,
    turnFailed: false,
    messages: [] as unknown[],
    model: undefined,
    stagedImages,
    folder: { uri: { fsPath: "/ws", path: "/ws" } },
    posted,
    host: { catalog: { defaultModel: undefined }, recordModelUsed() {} },
    client: () => ({
      prompt: async () => ({}),
      // 权威页:refreshMessages 拉到 msg_1 并替换占位。
      listMessages: async () => ({ data: [serverUserMessage] }),
    }),
    activeSelection: () => undefined,
    runningTurns: new Set<string>(),
    // 真原型方法:附件 URI 逻辑走实现本身,占位拼装行为才是被测对象。
    toPromptAttachment: proto.toPromptAttachment,
    toStoredAttachment: proto.toStoredAttachment,
    selectionAttachment: proto.selectionAttachment,
    // resolve 后调度的消息刷新走真实现(第 4 测的被测行为)。
    scheduleMessagesRefresh: proto.scheduleMessagesRefresh,
    refreshMessages: proto.refreshMessages,
    post(message: Record<string, unknown>) {
      posted.push(message);
    },
    startPermissionPolling() {},
    startSubagentPolling() {},
    renderableTranscript() {
      return controller.messages;
    },
    visibleDiffs: proto.visibleDiffs,
    // 以下成员供 refreshMessages(prompt resolve 后调度)完整运行:
    refreshTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    safeCall: proto.safeCall,
    pollSessionCurrent: proto.pollSessionCurrent,
    adoptPageCursor: proto.adoptPageCursor,
    flushDeltas: proto.flushDeltas,
    postMessages: proto.postMessages,
    pruneStreams: proto.pruneStreams,
    deltaTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    pendingDeltas: [] as unknown[],
    liveStreams: new Map<string, never>(),
    liveContent: new Map<string, never>(),
    turnCache: undefined as unknown,
    revertMessageID: undefined as unknown,
    earlierMessages: [] as unknown[],
    earlierCursor: undefined as unknown,
    hasEarlier: false,
    loadingEarlier: false,
    // 本文件只关心消息侧;刷新连锁触发的 diff 部分静默。
    refreshDiffs() {},
  };
  return controller;
}

/** 发送瞬间 post 出来的乐观占位气泡。 */
function optimisticBubble(posted: Array<Record<string, unknown>>): UserMessage | undefined {
  for (const message of [...posted].reverse()) {
    if (message.kind !== "messages") {
      continue;
    }
    const messages = message.messages as UserMessage[];
    const bubble = messages.find((m) => typeof m.id === "string" && m.id.startsWith("local-"));
    if (bubble) {
      return bubble;
    }
  }
  return undefined;
}

describe("optimistic bubble attachments", () => {
  test("a staged image is inlined in the placeholder bubble", async () => {
    // 服务器实捕形状:粘贴图片以 inline 存储(attachment-rows.test.ts 样本)。
    const controller = sendControllerWith(
      new Map([["staged:img-1", { name: "shot.png", mime: "image/png", data: "QUJD" }]]),
    );

    await sendNow.call(
      controller as unknown as ChatController,
      "看看这张图",
      [{ ref: "staged:img-1", name: "shot.png", kind: "image" }],
      "ses_a",
    );

    const bubble = optimisticBubble(controller.posted as Array<Record<string, unknown>>);
    assert.deepEqual(bubble?.files, [
      { data: "QUJD", mime: "image/png", source: { type: "inline" }, name: "shot.png" },
    ]);
  });

  test("a selection keeps its line range in the placeholder bubble", async () => {
    // 与服务器存储对齐:选区走 file: URI + L1-L2 描述(实捕样本同款)。
    const ref: AttachmentRef = {
      ref: "/ws/src/panel.ts",
      name: "panel.ts",
      kind: "selection",
      range: { start: 1, end: 2 },
    };
    const controller = sendControllerWith(new Map());

    await sendNow.call(controller as unknown as ChatController, "看这段", [ref], "ses_a");

    const bubble = optimisticBubble(controller.posted as Array<Record<string, unknown>>);
    assert.deepEqual(bubble?.files, [
      {
        data: "",
        mime: "",
        source: {
          type: "uri",
          uri: `${pathToFileURL("/ws/src/panel.ts").href}?start=1&end=2`,
        },
        name: "panel.ts",
        description: "L1-L2",
      },
    ]);
  });

  test("a plain file keeps its file URI in the placeholder bubble", async () => {
    // 与服务器存储对齐:文件走 file: URI,无 data(渲染按 file 行处理)。
    const ref: AttachmentRef = { ref: "/ws/CHANGELOG.md", name: "CHANGELOG.md", kind: "file" };
    const controller = sendControllerWith(new Map());

    await sendNow.call(controller as unknown as ChatController, "看文件", [ref], "ses_a");

    const bubble = optimisticBubble(controller.posted as Array<Record<string, unknown>>);
    assert.deepEqual(bubble?.files, [
      {
        data: "",
        mime: "",
        source: { type: "uri", uri: pathToFileURL("/ws/CHANGELOG.md").href },
        name: "CHANGELOG.md",
      },
    ]);
  });

  test("the authoritative user message replaces the bubble right after the prompt resolves", async () => {
    // 2026-11-21 实测:服务器在 /prompt 周期内已把 user 消息连同 files 入库,
    // 但面板刷新只挂在模型响应侧事件上——附件行要等很久才被权威消息替换。
    // prompt resolve 后必须立即调度一次刷新,占位即刻替换且不闪变。
    const ref: AttachmentRef = { ref: "staged:img-1", name: "shot.png", kind: "image" };
    const controller = sendControllerWith(
      new Map([["staged:img-1", { name: "shot.png", mime: "image/png", data: "QUJD" }]]),
    );

    await sendNow.call(controller as unknown as ChatController, "看看这张图", [ref], "ses_a");
    // scheduleMessagesRefresh(0) 走 setTimeout(0),留一拍让回调执行。
    await new Promise((resolve) => setTimeout(resolve, 10));

    const posted = controller.posted as Array<Record<string, unknown>>;
    const replaced = posted.some(
      (payload) =>
        payload.kind === "messages" &&
        (payload.messages as UserMessage[]).some((message) => message.id === "msg_1"),
    );
    // 刷新落地后 webview 收到过权威消息,且其后不再有占位气泡存留。
    assert.ok(replaced, "prompt resolve 后应调度刷新并 post 出权威消息 msg_1");
    const refreshPayload = [...posted]
      .reverse()
      .find((payload) => payload.kind === "messages") as {
      messages: UserMessage[];
    };
    assert.equal(
      refreshPayload.messages.some((message) => message.id.startsWith("local-")),
      false,
      "刷新后最终载荷不应再含占位气泡",
    );
  });
});
