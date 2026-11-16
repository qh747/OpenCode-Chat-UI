# 05 SubagentStrip 默认折叠

Status: resolved
Type: task

按 spec 分支 5 实施。验收：默认折叠仅显标题行；标题可点 + ▾/▸；新子代理启动自动展开一次；不持久化；折叠态标题行有运行中脉冲指示。

## Comments

### 2026-11-17

- `SubagentStrip.tsx`：`collapsed` state 默认 true；标题行改 `<button>` 可点切换（aria-expanded + ▾/▸ chev）；`seenRef` 记录已见 job id，出现新 job 自动展开一次；不持久化；折叠态标题行渲染 `.subagent-pulse` 脉冲点（列表内 job 均为 running，故 jobs>0 即在跑）。
- styles.css：`.subagent-head` 改按钮样式（可点、全宽、hover 高亮），新增 `.subagent-chev`/`.subagent-pulse`。
- 测试开口 `initialExpanded?: boolean`（默认折叠）；`test/subagents.test.ts` 原"每行渲染"用例改为展开态断言，新增默认折叠断言用例。
- typecheck / lint / 233 测试全绿。

