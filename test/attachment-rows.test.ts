import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../webview-ui/MessageList";
import type { MessageInfo } from "../src/opencode/types";

/**
 * These payloads are what a live opencode server stored for a message with a
 * pasted image and a selected range (captured from `opencode serve`): the
 * image comes back inline, the selection keeps its `file:` URI and the
 * `L1-L5` description the host wrote.
 */
const STORED_IMAGE = {
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  mime: "image/png",
  source: { type: "inline" as const },
  name: "image.png",
};

const STORED_SELECTION = {
  data: "IyBDaGFuZ2Vsb2cK",
  mime: "text/plain",
  source: {
    type: "uri" as const,
    uri: "file:///h:/MyCode/opencode-plugin/CHANGELOG.md?start=1&end=5",
  },
  name: "CHANGELOG.md",
  description: "L1-L5",
};

function render(messages: MessageInfo[]): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      messages,
      busy: false,
      onRewind: () => {},
      onOpenUrl: () => {},
      onOpenFile: () => {},
      onCopyCode: () => {},
    }),
  );
}

function userMessage(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    type: "user",
    id: "u1",
    time: { created: 1 },
    text: "看看这个文件",
    ...overrides,
  } as MessageInfo;
}

describe("attachment rows", () => {
  test("a pasted image is shown as an image, not as a file name", () => {
    const html = render([userMessage({ files: [STORED_IMAGE] } as never)]);

    // The row carries the image itself, so the webview can show it.
    assert.match(html, /data:image\/png;base64,/);
  });

  test("a selection keeps the line range in its detail line", () => {
    const html = render([userMessage({ files: [STORED_SELECTION] } as never)]);

    assert.match(html, /L1-L5/);
  });

  test("a file's path is shown the way the server stored it", () => {
    const html = render([userMessage({ files: [STORED_SELECTION] } as never)]);

    // The drive letter keeps the server's case; the query string the server
    // kept on the URI is not part of the path.
    assert.match(html, /h:\/MyCode\/opencode-plugin\/CHANGELOG\.md/);
    assert.doesNotMatch(html, /start=1/);
  });
});
