import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextBar } from "../webview-ui/ContextBar";
import type { GitInfo } from "../src/webview/protocol";

const GIT: GitInfo = { branch: "main", dirty: true } as GitInfo;

function render(props: Partial<Parameters<typeof ContextBar>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ContextBar, {
      git: GIT,
      workspacePath: "h:\\MyCode\\opencode-plugin",
      contextTokens: 43147,
      contextLimit: 1_048_576,
      ...props,
    }),
  );
}

describe("context bar clickable segments", () => {
  test("without handlers the branch and path stay plain text", () => {
    const html = render();
    assert.match(html, /<span class="ctx-branch">⎇ main<\/span>/);
    assert.match(html, /<span class="ctx-path"/);
  });

  test("handlers turn the branch and path into action buttons", () => {
    const html = render({
      onOpenSourceControl: () => {},
      onRevealInExplorer: () => {},
    });
    assert.match(html, /<button class="ctx-branch ctx-link" title="Open Source Control"/);
    assert.match(html, /<button class="ctx-path ctx-link" title="Reveal in Explorer · h:\\MyCode\\opencode-plugin"/);
    assert.doesNotMatch(html, /<span class="ctx-branch"/);
    assert.doesNotMatch(html, /<span class="ctx-path"/);
  });

  test("a fresh session still shows usage: 0 of the limit and an unknown cache rate", () => {
    const html = render({ contextTokens: undefined, cacheHitRate: undefined });
    assert.match(html, /class="ctx-right/);
    assert.match(html, />0 \/ 1\.0M</);
    assert.match(html, /—/);
  });

  test("the no-git notice stays plain even with a handler", () => {
    const html = render({ git: { dirty: false } as GitInfo, onOpenSourceControl: () => {} });
    assert.match(html, /<span class="ctx-nogit"/);
    assert.doesNotMatch(html, /<button class="ctx-branch/);
  });
});
