# 01 只取根会话:服务端 parentID 过滤 + 本地兜底 + 行分组

Status: resolved
Type: task
Blocked by: —

按 spec D1.1–D1.4 实施。历史菜单数据源改为只含根会话：服务端 `parentID=null` 过滤为主（顺带修 `limit:100` 被 subagent 吃名额的污染），本地 `rootSessions` 兜底；折叠删除后日期分组按行自身 `updated` 直分。

## 改动

1. **`src/opencode/client.ts`**：`listSessions` query 增加 `parentID?: string`；存在即写入 `params.set("parentID", …)`。注释记录线格式：字面量 `"null"` = 只回根会话（OpenAPI `enum["null"]`），空串/裸参数会 400。
2. **`src/util/sessions.ts`**：
   - 新增 `rootSessions(rows: HistoryRow[]): HistoryRow[]`（`parentID === undefined`）。
   - 新增 `groupHistoryRowsByDate(rows: HistoryRow[])`（内部复用 `groupByDate`，`updatedOf = row.updated`）。
   - 删除 `aggregateRowStatus` / `foldSubagentSessions` / `rootFoldOf` / `rootToExpand` / `groupFoldedByDate` / `FoldedHistoryRow`。
3. **`src/webview/panel.ts`** `postHistory`：`listSessions({…, parentID: "null"})`；行构造后 `rootSessions(rows)` 兜底；`groupHistoryRowsByDate(rootRows)` 取代 fold+groupFoldedByDate。

## 测试缝（TDD）

- 红：`test/client-routes.test.ts` 新用例——`listSessions({parentID: "null"})` URL 含 `&parentID=null`；不传无该参数。
- 红：`test/sessions.test.ts`——`rootSessions` 两例（根保留并滤除子会话合并为一例 / 孤儿滤除）；`groupHistoryRowsByDate` 按行自身时间分桶（继承原 groupFoldedByDate 用例语义）。
- 删除：foldSubagentSessions 九例、aggregateRowStatus 六例、rootToExpand 四例、groupFoldedByDate 一例。

## 验证

- `npm run typecheck`、`npm run lint`、全量 `npm test`。

## Comments

- 2026-11-21 红绿完成：route 测试先红（URL 缺 `parentID=null`）后绿；`rootSessions` 两例 + `groupHistoryRowsByDate` 一例绿；fold 系 18 例删除。线格式经活体验证（opencode 2.3.2：`parentID=null` 只回根，baseline 6 行滤掉 4 行子会话；空串/裸参数/`undefined` 均 400）。typecheck/lint/全量干净。
