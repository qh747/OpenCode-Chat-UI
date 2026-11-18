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

describe("history row aggregate status (ADR-0010)", () => {
  const parentTitle = (html: string): string =>
    (html.match(/<span class="history-title[^"]*">父会话<\/span>/) ?? [""])[0] ?? "";

  test("a folded row with a working child is green, not the old red warning", () => {
    const html = renderMenu(new Set());
    // 折叠行聚合自己与子代理：working → 绿（推翻 2026-11-17 的红色警示）。
    assert.doesNotMatch(html, /has-running-children/);
    assert.match(parentTitle(html), /status-working/);
  });

  test("an expanded root row aggregates the same way", () => {
    const html = renderMenu(new Set(["ses_parent"]));
    assert.doesNotMatch(html, /has-running-children/);
    // 父会话行自身（不是子代理行）也聚合出 working 绿。
    assert.match(parentTitle(html), /status-working/);
  });

  test("a blocked child paints the root red", () => {
    const blockedChild: HistoryRow = { ...runningChild, status: "blocked" };
    const html = renderToStaticMarkup(
      createElement(HistoryMenu, {
        dispatch,
        groups: [{ label: "今天", sessions: foldSubagentSessions([parent, blockedChild]) }],
        currentSessionId: undefined,
        onOpen,
        initialExpanded: new Set<string>(),
        initialOpen: true,
      }),
    );
    assert.match(parentTitle(html), /status-failed/);
  });
});
