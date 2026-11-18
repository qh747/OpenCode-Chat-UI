import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffList } from "../webview-ui/Cards";
import type { FileDiffInfo } from "../src/opencode/types";

const DIFFS: FileDiffInfo[] = [
  { file: "h:\\proj\\TEST.md", status: "added", additions: 14, deletions: 0, patch: "" },
  { file: "h:\\proj\\src\\panel.ts", status: "modified", additions: 12, deletions: 3, patch: "" },
];

function render(diffs: FileDiffInfo[], maxVisibleRows = 5, initialOpen = false): string {
  return renderToStaticMarkup(
    createElement(DiffList, {
      diffs,
      maxVisibleRows,
      initialOpen,
      onOpen: () => {},
      onRevert: () => {},
    }),
  );
}

describe("diff list", () => {
  test("collapsed by default: a header with the count, no rows, no totals", () => {
    const html = render(DIFFS);
    assert.match(html, /Changes 2/);
    assert.doesNotMatch(html, /\+26/);
    assert.doesNotMatch(html, /TEST\.md/);
    assert.doesNotMatch(html, /diff-status-badge/);
    assert.match(html, /aria-expanded="false"/);
  });

  test("expanded rows carry the change type as a class, no status text", () => {
    const html = render(DIFFS, 5, true);
    assert.match(html, /class="diff-card st-added"/);
    assert.match(html, /class="diff-card st-modified"/);
    assert.doesNotMatch(html, /diff-status-badge/);
    assert.match(html, /TEST\.md/);
  });

  test("nothing renders when there is nothing to show", () => {
    assert.equal(render([]), "");
  });

  test("row cap is plumbed through as the --diff-max-rows style", () => {
    assert.match(render(DIFFS), /--diff-max-rows:5/);
    assert.match(render(DIFFS, 3), /--diff-max-rows:3/);
  });
});
