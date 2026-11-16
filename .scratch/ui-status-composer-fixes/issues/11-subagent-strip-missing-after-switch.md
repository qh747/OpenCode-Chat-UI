# 11 切回主会话后 SubagentStrip 不显示

Status: resolved
Type: task

来源：用户装 vsix 人工测试（0.4.11.vsix）反馈：查看子代理会话内容后回到主会话，子代理仍在运行，但主会话输入框上方的子代理信息条不显示。

## Comments

### 2026-11-17（诊断，diagnosing-bugs 流程）

- 根因链：`switchSession()` 先 `clearSubagents()` 再 `fullResync()`；`fullResync()` 仅在 `if (this.busy)` 时 `startSubagentPolling()`。分支 4 修复后等待子代理的父会话（idle）busy 恒为 false → 轮询不启动 → strip 空白。
- 修复：`fullResync()` 改为无条件 `this.startSubagentPolling()`。自清机制兜底：`refreshSubagents()` 末尾在"列表空且非 busy"时停表，一次空刷新即退出，不会常驻轮询；同时覆盖面板重载/宿主 resync 等所有 fullResync 入口。
- seam 说明：panel.ts 依赖 vscode 模块，测试 bundle 将其 external（import 即崩），无面板级单测先例——无正确 seam 本身即发现，按 skill 记录。验证靠静态推理 + 人工 vsix 复验。
- typecheck/lint/236 测试全绿。

### 2026-11-17（Phase 6）

- 无自动化回归测试（seam 缺失见上）；待用户重装 vsix 后人工复验：切走再切回，等待子代理的主会话应立即显示 SubagentStrip。
