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

function render(diffs: FileDiffInfo[], maxVisibleRows = 5): string {
  return renderToStaticMarkup(
    createElement(DiffList, {
      diffs,
      maxVisibleRows,
      onOpen: () => {},
      onKeep: () => {},
      onRevert: () => {},
    }),
  );
}

describe("diff list", () => {
  test("collapsed by default: a header with the counts, no rows", () => {
    const html = render(DIFFS);
    assert.match(html, /Changes 2/);
    assert.match(html, /\+26/);
    assert.match(html, /-3/);
    assert.doesNotMatch(html, /TEST\.md/);
    assert.doesNotMatch(html, /Keep/);
    assert.doesNotMatch(html, /Revert/);
    assert.match(html, /aria-expanded="false"/);
  });

  test("nothing renders when there is nothing to show", () => {
    assert.equal(render([]), "");
  });

  test("row cap is plumbed through as the --diff-max-rows style", () => {
    assert.match(render(DIFFS), /--diff-max-rows:5/);
    assert.match(render(DIFFS, 3), /--diff-max-rows:3/);
  });
});
