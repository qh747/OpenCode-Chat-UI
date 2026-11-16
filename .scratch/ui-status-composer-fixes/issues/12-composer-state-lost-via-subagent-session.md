# 12 子代理会话往返后主会话已上传图片丢失

Status: resolved
Type: task

来源：用户装 vsix 人工测试反馈：在 A 会话上传一张图片，查看 B 会话后回到 A，图片消失。

## Comments

### 2026-11-17（诊断，diagnosing-bugs 流程）

- 红环：`test/composer-persistence.test.ts`（renderToStaticMarkup 渲染 App）断言 `isSubagentSession: true` 时 Composer 仍挂载（`composer-slot is-hidden` + `<textarea`）；原实现下 Composer 被条件卸载 → 断言红，复现状态丢失的结构性根因。
- 根因：Composer 的 chips/草稿是组件局部 state，而 app.tsx 以 `!state.isSubagentSession` 条件渲染——切到子代理会话（parentID 非空，`refreshSessionMeta` 置位）时 Composer **卸载**，回到主会话重新挂载即空白；且 app.tsx 的 `consumedImages` ref（Main 级，跨会话存活）已把 staged 图标记为已消费，重挂载后不会重投。
- 修复：Composer 始终挂载，外层 `composer-slot` 包裹 + `.is-hidden { display: none }`（styles.css）。顺带修复同类丢失：主会话草稿文本、mention/preview 状态、imageNotice 在子代理会话往返后全部保留。
- seam 说明：chips 的交互级持久性（粘贴→chip→往返仍在）无自动化 seam——App 无交互测试环境，静态渲染仅能锁定结构契约。交互行为靠人工 vsix 复验。
- 副作用评估：隐藏挂载的 Composer 内的 document 级图片粘贴监听（分支 9）在子代理会话中仍生效——粘贴的图会静默 stage 并在回到主会话后出现在 chip 区，属期望行为。
- 红转绿：238 用例 62 套件全绿，typecheck/lint 0 错。
