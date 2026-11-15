import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionInfo } from "../webview-ui/SessionInfo";
import type { MessageInfo } from "../src/webview/protocol";

const MESSAGES: MessageInfo[] = [
  {
    type: "system",
    id: "msg_sys",
    time: { created: 1700000000000 },
    text: "You are a coding agent.",
  } as unknown as MessageInfo,
  { type: "user", id: "msg_u1", time: { created: 1700000001000 }, text: "hi" } as MessageInfo,
  {
    type: "assistant",
    id: "msg_a1",
    time: { created: 1700000002000 },
    tokens: { input: 476, output: 244, reasoning: 23, cache: { read: 12800, write: 0 } },
  } as MessageInfo,
  { type: "idle", id: "msg_i1" } as MessageInfo,
];

function render(props: Partial<Parameters<typeof SessionInfo>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(SessionInfo, {
      open: true,
      onClose: () => {},
      onExport: () => {},
      title: "模型连接测试",
      providerID: "opencode-go",
      modelName: "MiMo-V2.6-Flash",
      contextLimit: 1_048_576,
      created: 1700000000000,
      updated: 1700000060000,
      cost: 0,
      contextTokens: 13543,
      messages: MESSAGES,
      ...props,
    }),
  );
}

describe("session info", () => {
  test("closed renders nothing", () => {
    assert.equal(render({ open: false }), "");
  });

  test("stat grid mirrors the desktop layout", () => {
    const html = render();
    assert.match(html, /模型连接测试/);
    assert.match(html, /OpenCode Go/);
    assert.match(html, /MiMo-V2.6-Flash/);
    assert.match(html, /1,048,576/);
    assert.match(html, /13,543/);
    assert.match(html, /1%/); // 13543 / 1048576 rounded
    assert.match(html, /476/);
    assert.match(html, /12,800 \/ 0/);
    assert.match(html, /US\$0\.00/);
  });

  test("message counts include idle and split by type", () => {
    const html = render();
    assert.match(html, new RegExp(`>${MESSAGES.length}<`));
    assert.match(html, /msg_sys/);
    assert.match(html, /msg_i1/);
  });

  test("system prompt is collapsed by default", () => {
    const html = render();
    assert.match(html, /System prompt/);
    assert.doesNotMatch(html, /You are a coding agent\./);
  });

  test("export button present", () => {
    assert.match(render(), /Export session/);
  });

  test("system prompt uses the LAST system message and trims it", () => {
    // 最后一条 system 消息只有空白文本：对齐桌面端 findLast + trim 后应整块隐藏；
    // 旧的 find（取第一条）会显示 "You are a coding agent." —— 两者行为相反。
    const messages: MessageInfo[] = [
      MESSAGES[0]!,
      ...MESSAGES.slice(1),
      {
        type: "system",
        id: "msg_sys2",
        time: { created: 1700000003000 },
        text: "   ",
      } as unknown as MessageInfo,
    ];
    const html = render({ messages });
    assert.doesNotMatch(html, /System prompt/);
    assert.doesNotMatch(html, /You are a coding agent\./);
  });

  test("last activity shows the last billed message's time, not session updated", () => {
    const html = render({ updated: 1700000099999 });
    // msg_a1（最后一条计费 assistant 消息）的 time.created，而非 updated
    assert.ok(html.includes(new Date(1700000002000).toLocaleString()));
    assert.ok(!html.includes(new Date(1700000099999).toLocaleString()));
  });
});
