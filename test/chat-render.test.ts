import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../webview-ui/MessageList";
import type { AssistantContent, MessageInfo } from "../src/opencode/types";

function render(messages: MessageInfo[]): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      busy: false,
      hasEarlier: false,
      loadingEarlier: false,
      onRewind: () => {},
      onOpenUrl: () => {},
      onOpenFile: () => {},
      onCopyCode: () => {},
    }),
  );
}

function assistantMessage(content: AssistantContent[]): MessageInfo {
  return { type: "assistant", id: "a1", time: { created: 1 }, content };
}

describe("transcript rendering", () => {
  test("a tool call reads as a verb, with its target and a chevron", () => {
    const html = render([
      assistantMessage([
        {
          type: "tool",
          id: "t1",
          name: "bash",
          state: {
            status: "completed",
            input: { command: "npm test" },
            content: [{ type: "text", text: "83 passed" }],
          },
        },
      ]),
    ]);

    assert.match(html, /Ran command/);
    assert.match(html, /npm test/);
    assert.match(html, /tool-row-chev/);
  });

  test("a failed tool shows the reason the server sent", () => {
    const html = render([
      assistantMessage([
        {
          type: "tool",
          id: "t1",
          name: "bash",
          state: {
            status: "error",
            input: { command: "npm test" },
            error: { message: "Command failed with exit code 1" },
          },
        },
      ]),
    ]);

    assert.match(html, /tool-row-error/);
    assert.match(html, /Command failed with exit code 1/);
  });

  test("thinking reports how long it took", () => {
    const html = render([
      assistantMessage([
        {
          type: "reasoning",
          text: "thinking out loud",
          time: { created: 100, completed: 4200 },
        },
      ]),
    ]);

    assert.match(html, /Thought for 4s/);
  });

  test("a user message is a bubble on the right", () => {
    const html = render([
      { type: "user", id: "u1", time: { created: 1 }, text: "hello" },
    ]);

    assert.match(html, /class="msg user"/);
  });

  test("attachments collapse into one summary line under the bubble", () => {
    const html = render([
      {
        type: "user",
        id: "u1",
        time: { created: 1 },
        text: "这个文件的作用是什么",
        files: [
          {
            data: "",
            mime: "text/markdown",
            name: "CHANGELOG.md",
            source: { type: "uri", uri: "file:///h:/w/CHANGELOG.md" },
          },
        ],
      },
    ]);

    assert.match(html, /class="attach-group"/);
    assert.match(html, /1 attachments/);
    assert.match(html, /CHANGELOG\.md/);
  });

  test("a link leaves the message text and becomes a row of its own", () => {
    const html = render([
      {
        type: "user",
        id: "u1",
        time: { created: 1 },
        text: "看这个\n\n参考链接: https://example.com/a",
      },
    ]);

    assert.match(html, /example\.com/);
    assert.doesNotMatch(html, /参考链接/);
  });

  test("a message without attachments shows no attachment group", () => {
    const html = render([
      { type: "user", id: "u1", time: { created: 1 }, text: "hello" },
    ]);

    assert.doesNotMatch(html, /attach-group/);
  });

  test("code blocks get a copy button and tables a scroll container", () => {
    const html = render([
      assistantMessage([
        { type: "text", text: "```ts\nconst a = 1;\n```" },
        { type: "text", text: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
      ]),
    ]);

    assert.match(html, /md-code-copy/);
    assert.match(html, /md-table/);
  });
});
