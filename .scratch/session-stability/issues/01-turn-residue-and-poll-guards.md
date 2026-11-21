# 01 翻页残留修复：离开会话必清回填历史 + 权限/表单轮询守卫

Status: implemented
Type: task

**What to build**（用户视角）：我在读过旧会话历史后点"+"新建会话，面板立刻翻到干净的新会话页面——消息流清空、旧会话内容一滴不剩；删除会话后同样不残留；新页面永不出现旧会话的权限卡或表单。

**Blocked by**：None（可立即开始）。

根因与修法（spec「Implementation Decisions」）：
- `createSession()`（`src/webview/panel.ts:588`）漏调 `resetLoadedHistory()`——旧会话回填的 `earlierMessages` 经 `renderableTranscript()`（`:1790`）合入新会话快照。对比 `switchSession`（`:662`）、`rewindTo`（`:1278`）、revert 变化（`:2314`）三处都有调。
- 兄弟路径同修（spec Q8）：`deleteSessionById`（`:1349` 附近）与 `session.deleted` 事件分支（`:1656`）同样漏调；落点可选共享拆除点 `dropSessionState`（`:942`），按共享断言决定。
- 轮询守卫（审计附带 1）：`refreshPermissions`/`refreshForms`（`:1985`/`:2014`）加会话守卫——发轮询前捕获当前 sessionId、写回前比对，镜像 `refreshMessages` 的 `pollSessionCurrent` 捕获-比对模式（`panel.ts:1763`/`:2165`）。

验收（TDD 先红后绿，宿主 harness 先例：`test/session-switch.test.ts`、`test/earlier-store.test.ts`）：

- [x] 复现配方先红：旧会话滚顶触发回填 → 点 + → 现状快照带旧消息；修复后下一条快照 messages 为空、hasEarlier=false
- [x] 删除路径两条（历史行删除、`session.deleted` 事件）均不残留已删会话的回填消息
- [x] 残留的旧游标不再污染新会话的后续 `loadEarlier`
- [x] 新建/切换会话后，旧会话晚到的权限/表单轮询不落宿主态、不出现在新会话快照
- [x] 新用例注册进 `test/run.ts`；全量验证（lint/typecheck/test）通过

明确不做：断连静默 no-op 的既有设计（`panel.ts:486` 横幅兜底）；`refreshDiffs`/subagents 轮询（已有双检）。

## Comments

- 2026-11-22（实施，agent）：TDD 红绿完成。新用例 `test/session-stability.test.ts`（宿主 harness：真 `ChatController.prototype` 方法 + fake client + 快照记录，接缝同 `earlier-store.test.ts` 先例），已注册进 `test/run.ts`。红→绿确认：createSession 残留、两条删除路径残留、权限/表单守卫缺失全部先红后绿；"别的会话删除/事件不动当前回填"与"守卫不误伤正常路径"两条为行为锁。
- 修复落点（Q8 共享断言决定）：`createSession` 在 `this.messages = []` 后内联补 `resetLoadedHistory()`（镜像 `switchSession`）；两条删除路径（历史行删除 + `session.deleted` 事件）的当前会话分支走共享拆除点 `dropSessionState` 的 `id === this.sessionId` 分支补调——一处覆盖两条触发源，表单先例（显示态清在 dropSessionState 的当前会话分支）已确立此归属。非当前会话分支不动（测试锁定）。
- 权限/表单守卫：`refreshPermissions`/`refreshForms` 在 await 后、写回前补 `pollSessionCurrent` 捕获-比对（镜像 `refreshMessages` `panel.ts:1763`），晚到答案不落宿主态、不发事件。
- fixture 修（CODING_STANDARDS 语义反转分类）：`test/dismissed-memory.test.ts` 两个 harness 补 `resetLoadedHistory: () => {}` no-op 桩（真 `dropSessionState` 新增调用触及；主题为驻留记忆，断言原文一字未动）。
- 全量验证：typecheck 通过；`node out/tests.cjs` 521 用例全过（exit 0）。
- 2026-11-22（code-review 后修复）：恢复 `deleteController` harness 中被顺手误删的 `stagedImages` 字段（评审发现两个 fake 桩不对称；无行为影响，全量测试仍绿）。
