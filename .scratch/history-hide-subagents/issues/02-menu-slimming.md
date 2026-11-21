# 02 菜单减脂:行状态直挂 + 高亮主行 + 折叠渲染删除

Status: resolved
Type: task
Blocked by: 01

按 spec D1.4/D1.5/D2/D3 实施。HistoryMenu 只渲染根会话行：颜色挂行自身状态，折叠 caret/子行/计数徽章/强制展开全部删除；当前会话是子会话时高亮其直接父级的行。

## 改动

1. **`src/webview/protocol.ts`**：`HistoryGroup.sessions: HistoryRow[]`；移除 `FoldedHistoryRow` import。
2. **`webview-ui/HistoryMenu.tsx`**：
   - 删 `expanded` state / `toggle` / `forcedRoot` / caret span / 子行渲染 / `history-subagents` 计数 span / `initialExpanded` 测试开口。
   - 行标题 class 直挂 `session.status`（注释引 ADR-0016）。
   - prop `currentSessionId` 语义改为「应高亮的行 id」；注释说明 app 层已把子会话折算为其父级。
3. **`webview-ui/app.tsx`**：`currentSessionId={state.isSubagentSession ? state.parentSessionID : state.sessionID}`。
4. **`src/util/i18n.ts`**：删 `historySubagentCount` / `historySubagentCountOne` / `historySubagentRunning`（en+zh）。
5. **`webview-ui/styles.css`**：删 `.history-caret` 块（含 `.is-empty`）、`.history-child .history-row` 缩进、`.history-subagents`；status 注释改为引用 ADR-0016（只看行自身状态）。

## 测试缝（TDD）

- 红→绿：`test/history-menu.test.ts` 重写——
  - 行颜色直挂：working 行绿、idle 行无 `status-*`、failed 行红；
  - 无子行/caret/计数（child 行根本不出现在 groups 里）；
  - `currentSessionId` 传父级 id → 该行 `is-current`。
- 旧断言删除：ADR-0010 聚合色三例（折叠绿/展开绿/阻塞子染红）。

## 验证

- typecheck / lint / 全量测试。

## Comments

- 2026-11-21 完成实施。实施差异两处：① 测试断言按实际行为校准——idle 行渲染 `status-idle` class（无 CSS 规则即默认前景色，与 ADR-0010 时代一致），断言改为锁定 `status-idle` 而非「无 class」；② 「子行不出现在标记」的断言撤到组件层之外——组件只是渲染 host 给的行，过滤在 host 层（工票 01 的 `rootSessions`），组件层锁定「无 caret/无计数徽章」。高亮折算按 D3 用既有 `parentSessionID`，零协议增量。
