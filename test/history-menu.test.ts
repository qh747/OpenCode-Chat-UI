import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryMenu } from "../webview-ui/HistoryMenu";
import { foldSubagentSessions } from "../src/util/sessions";
import type { HistoryRow } from "../src/util/sessions";
import type { HistoryGroup } from "../src/webview/protocol";
import type { Dispatch } from "../webview-ui/state";

const dispatch: Dispatch = () => {};
const onOpen = () => {};

const parent: HistoryRow = {
  id: "ses_parent",
  title: "父会话",
  created: 1_000,
  updated: 2_000,
  status: "idle",
};

const runningChild: HistoryRow = {
  id: "ses_child",
  title: "子代理",
  parentID: "ses_parent",
  created: 1_500,
  updated: 1_600,
  status: "working",
};

function groups(): HistoryGroup[] {
  return [{ label: "今天", sessions: foldSubagentSessions([parent, runningChild]) }];
}

function renderMenu(expanded: ReadonlySet<string>): string {
  return renderToStaticMarkup(
    createElement(HistoryMenu, {
      dispatch,
      groups: groups(),
      currentSessionId: undefined,
      onOpen,
      initialExpanded: expanded,
      initialOpen: true,
    }),
  );
}

describe("history title running-children warning", () => {
  test("a folded row with running children warns red on the title", () => {
    const html = renderMenu(new Set());
    assert.match(html, /has-running-children/);
  });

  test("an expanded row does not warn red — children show their own green", () => {
    const html = renderMenu(new Set(["ses_parent"]));
    assert.doesNotMatch(html, /has-running-children/);
    // 展开后子代理行直接可见，自身状态色仍在。
    assert.match(html, /status-working/);
  });
});
