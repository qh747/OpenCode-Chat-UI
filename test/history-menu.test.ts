import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryMenu } from "../webview-ui/HistoryMenu";
import type { HistoryRow } from "../src/util/sessions";
import type { Dispatch } from "../webview-ui/state";

const dispatch: Dispatch = () => {};
const onOpen = () => {};

const working: HistoryRow = {
  id: "ses_working",
  title: "跑着的会话",
  created: 1_000,
  updated: 2_000,
  status: "working",
};

const idle: HistoryRow = {
  id: "ses_idle",
  title: "闲会话",
  created: 1,
  updated: 2,
  status: "idle",
};

function renderMenu(currentSessionId?: string, rows: HistoryRow[] = [working, idle]): string {
  return renderToStaticMarkup(
    createElement(HistoryMenu, {
      dispatch,
      groups: [{ label: "今天", sessions: rows }],
      currentSessionId,
      onOpen,
      initialOpen: true,
    }),
  );
}

const spanOf = (html: string, title: string): string =>
  (html.match(new RegExp(`<span class="history-title[^"]*">${title}</span>`)) ?? [""])[0];

describe("history rows paint their own status (ADR-0016)", () => {
  test("a working session is green on its own row", () => {
    assert.match(spanOf(renderMenu(), "跑着的会话"), /status-working/);
  });

  test("an idle session carries only the neutral status-idle class", () => {
    // status-idle 无 CSS 规则 → 默认前景色；这是既有行为（ADR-0010 时代亦然）。
    assert.match(spanOf(renderMenu(), "闲会话"), /^<span class="history-title status-idle">/);
  });

  test("a failed session is red", () => {
    const html = renderMenu(undefined, [{ ...idle, status: "failed" }]);
    assert.match(spanOf(html, "闲会话"), /status-failed/);
  });

  test("a blocked session is yellow", () => {
    const html = renderMenu(undefined, [{ ...idle, status: "blocked" }]);
    assert.match(spanOf(html, "闲会话"), /status-blocked/);
  });
});

describe("the menu has no folding affordances (spec D1)", () => {
  test("no caret and no subagent-count markup anywhere", () => {
    // 过滤本身在 host 层（rootSessions + 服务端 parentID，工票 01）；
    // 组件层锁定：折叠机构（caret/子行缩进/计数徽章）不再存在于标记里。
    const html = renderMenu();
    assert.doesNotMatch(html, /history-caret/);
    assert.doesNotMatch(html, /history-subagents/);
  });
});

describe("current-session highlight walks up to the parent (spec D3)", () => {
  test("the parent row is highlighted while its child session is on screen", () => {
    assert.match(renderMenu("ses_working"), /history-row is-current/);
  });

  test("no row is highlighted for an id the menu does not list", () => {
    assert.doesNotMatch(renderMenu("ses_missing"), /is-current/);
  });
});
