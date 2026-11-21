// session-stability 工票 02：历史列表创建序（spec Q7）。
// 断言锁行为契约——排序、分桶键、时间列三处一体：位置不随活动移动。
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryMenu } from "../webview-ui/HistoryMenu";
import {
  groupHistoryRowsByDate,
  groupSessionsByDate,
  sortByCreatedDesc,
} from "../src/util/sessions";
import type { HistoryRow } from "../src/util/sessions";
import type { SessionInfo } from "../src/opencode/types";
import type { Dispatch } from "../webview-ui/state";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const row = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "ses_row",
  created: 1,
  updated: 2,
  status: "idle",
  ...overrides,
});

const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "ses_session",
  projectID: "proj",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/tmp" },
  ...overrides,
});

describe("sortByCreatedDesc（客户端创建序重排，spec Q7）", () => {
  test("按 created 倒序，无视服务器按 updated 排好的输入序", () => {
    const now = Date.now();
    // 输入模拟服务器响应：updated 倒序，created 乱序。
    const ordered = sortByCreatedDesc(
      [
        row({ id: "ses_old", created: now - hour, updated: now }),
        row({ id: "ses_new", created: now - 5 * minute, updated: now - 10 * minute }),
      ],
      (r) => r.created,
    );
    assert.deepEqual(ordered.map((r) => r.id), ["ses_new", "ses_old"]);
  });

  test("updated 单独翻动永不改变行序", () => {
    const now = Date.now();
    const rows = [
      row({ id: "ses_c", created: now - 5 * minute, updated: now }),
      row({ id: "ses_b", created: now - 30 * minute, updated: now }),
      row({ id: "ses_a", created: now - hour, updated: now }),
    ];
    // 老会话 ses_a 刚有活动，服务器按 updated 倒序把它排到最前。
    const serverOrder = [
      row({ id: "ses_a", created: now - hour, updated: now }),
      ...rows.filter((r) => r.id !== "ses_a"),
    ];
    assert.deepEqual(
      sortByCreatedDesc(serverOrder, (r) => r.created).map((r) => r.id),
      ["ses_c", "ses_b", "ses_a"],
    );
  });
});

describe("日期桶按 created 分（spec Q7：老会话刚有活动也不迁桶）", () => {
  test("history 行分桶键是 created", () => {
    const now = Date.now();
    const groups = groupHistoryRowsByDate([
      row({ id: "ses_stale", created: now - 40 * day, updated: now }),
    ]);
    assert.equal(groups.length, 1);
    // t("group.older") 的 en 文本：按 updated 分桶会落 Today，此处锁死。
    assert.equal(groups[0]?.label, "Earlier");
    assert.deepEqual(groups[0]?.sessions.map((r) => r.id), ["ses_stale"]);
  });

  test("QuickPick 路径的会话分桶键同样是 created", () => {
    const now = Date.now();
    const groups = groupSessionsByDate([
      session({ id: "ses_stale", time: { created: now - 40 * day, updated: now } }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.label, "Earlier");
    assert.deepEqual(groups[0]?.sessions.map((s) => s.id), ["ses_stale"]);
  });
});

describe("webview 历史行时间列显示创建时间", () => {
  const dispatch: Dispatch = () => {};
  const onOpen = () => {};

  function renderHistoryMenu(rows: HistoryRow[]): string {
    return renderToStaticMarkup(
      createElement(HistoryMenu, {
        dispatch,
        groups: [{ label: "Today", sessions: rows }],
        currentSessionId: undefined,
        onOpen,
        initialOpen: true,
      }),
    );
  }

  test("时间列读 created，不读 updated", () => {
    const now = Date.now();
    const html = renderHistoryMenu([
      row({ id: "ses_made", title: "刚建的会话", created: now - 2 * minute, updated: now - 3 * hour }),
    ]);
    // t("time.minutesAgo") 的 en 文本 = "{count}m ago"。
    assert.match(html, /刚建的会话<\/span><span class="history-time">2m ago<\/span>/);
    assert.doesNotMatch(html, /3h ago/);
  });
});

describe("行位在活动翻动后保持（工票 02 验收 1+2）", () => {
  test("同一批行 updated 翻转后，分组内顺序不变", () => {
    const now = Date.now();
    // 输入序模拟服务器响应（updated 同值，顺序任意），并非 created 倒序。
    const base = [
      row({ id: "ses_a", created: now - hour, updated: now - hour }),
      row({ id: "ses_b", created: now - 30 * minute, updated: now - hour }),
      row({ id: "ses_c", created: now - 5 * minute, updated: now - hour }),
    ];
    const before = groupHistoryRowsByDate(sortByCreatedDesc(base, (r) => r.created));
    assert.deepEqual(before[0]?.sessions.map((r) => r.id), ["ses_c", "ses_b", "ses_a"]);

    // 下次打开历史菜单：老会话 ses_a 刚有活动，服务器按 updated 倒序把它排到最前。
    const churned = [
      row({ id: "ses_a", created: now - hour, updated: now }),
      ...base.filter((r) => r.id !== "ses_a"),
    ];
    const after = groupHistoryRowsByDate(sortByCreatedDesc(churned, (r) => r.created));
    assert.deepEqual(after[0]?.sessions.map((r) => r.id), ["ses_c", "ses_b", "ses_a"]);
  });
});
