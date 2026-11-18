import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextBar, folderName } from "../webview-ui/ContextBar";
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
    assert.match(html, /<span class="ctx-branch">main<\/span>/);
    assert.match(
      html,
      /<span class="ctx-path" title="h:\\MyCode\\opencode-plugin">opencode-plugin<\/span>/,
    );
  });

  test("handlers turn the branch and path into action buttons", () => {
    const html = render({
      onOpenSourceControl: () => {},
      onRevealInExplorer: () => {},
    });
    assert.match(html, /<button class="ctx-branch ctx-link" title="Open Source Control"/);
    assert.match(
      html,
      /<button class="ctx-path ctx-link" title="Reveal in Explorer · h:\\MyCode\\opencode-plugin">opencode-plugin<\/button>/,
    );
    assert.doesNotMatch(html, /<span class="ctx-branch"/);
    assert.doesNotMatch(html, /<span class="ctx-path"/);
  });

  test("the path label is the last folder only, the title keeps the full path", () => {
    const html = render({ workspacePath: "/home/quhan/01_myProject/opencode-plugin" });
    assert.match(html, /title="\/home\/quhan\/01_myProject\/opencode-plugin">opencode-plugin</);
    assert.doesNotMatch(html, />\/home\/quhan/);
  });

  test("no workspace shows the no-dir marker instead of vanishing", () => {
    const html = render({
      workspacePath: undefined,
      git: undefined,
      contextTokens: undefined,
      contextLimit: undefined,
      cacheHitRate: undefined,
    });
    assert.match(html, /class="ctx-bar"/);
    assert.match(
      html,
      /<span class="ctx-path ctx-nodir" title="OpenCode: open a workspace folder first.">no dir<\/span>/,
    );
  });

  test("a fresh session still shows usage: 0 of the limit and 100% cache", () => {
    const html = render({ contextTokens: undefined, cacheHitRate: undefined });
    assert.match(html, /class="ctx-right/);
    assert.match(html, />0 \/ 1\.0M</);
    assert.match(html, /Cache hit rate">100%</);
  });

  test("a known cache rate renders as a whole percentage", () => {
    const html = render({ cacheHitRate: 0.68 });
    assert.match(html, /Cache hit rate">68%</);
    assert.doesNotMatch(html, /Cache hit rate">100%</);
  });

  test("the no-git notice stays plain even with a handler", () => {
    const html = render({ git: { dirty: false } as GitInfo, onOpenSourceControl: () => {} });
    assert.match(html, /<span class="ctx-nogit"/);
    assert.doesNotMatch(html, /<button class="ctx-branch/);
  });
});

describe("folderName", () => {
  test("takes the last segment of Unix and Windows paths", () => {
    assert.equal(folderName("/home/quhan/01_myProject/opencode-plugin"), "opencode-plugin");
    assert.equal(folderName("h:\\MyCode\\opencode-plugin"), "opencode-plugin");
    assert.equal(folderName("relative/project"), "project");
  });

  test("ignores trailing separators", () => {
    assert.equal(folderName("/home/quhan/project/"), "project");
    assert.equal(folderName("h:\\MyCode\\project\\\\"), "project");
  });

  test("a root path stays as itself", () => {
    assert.equal(folderName("/"), "/");
    assert.equal(folderName("h:\\"), "h:");
  });
});

describe("worktree branch tooltip", () => {
  test("a branch from another directory explains where it came from", () => {
    const html = render({
      git: { branch: "ticket/x", directory: "/wt/review-fix" } as GitInfo,
    });
    assert.match(
      html,
      /title="Branch of the agent&#x27;s working directory · \/wt\/review-fix"/,
    );
  });

  test("the plain branch keeps the SCM tooltip on the button", () => {
    const html = render({ onOpenSourceControl: () => {} });
    assert.match(html, /title="Open Source Control"/);
    assert.doesNotMatch(html, /working directory/);
  });

  test("the plain span carries no tooltip; the override span explains itself", () => {
    assert.doesNotMatch(render(), /<span class="ctx-branch" title/);
    const override = render({
      git: { branch: "ticket/x", directory: "/wt/review-fix" } as GitInfo,
    });
    assert.match(override, /<span class="ctx-branch" title=/);
  });
});
