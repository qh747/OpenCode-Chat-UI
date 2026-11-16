# 子代理三连问题排查

## 用户报告（原文要点）

1. 输入框上方看不到子代理（`SubagentStrip` 不出现）。
2. 子代理执行时主会话无法发送消息，消息进队列，"立即发送"无反应。期望：子代理执行时主会话不阻塞。
3. 子代理会话（child session）的输入框及其下方统计信息、git 分支、文件路径未隐藏。期望：子代理会话隐藏这些。

截图确认属于本仓库 webview，不是 TUI：`composerPlaceholderBusy = "模型处理中 · Enter 加入队列 · Esc 停止"`（`src/util/i18n.ts:323`）。

## 已确认事实

- `Job.Subagent` 契约与 `toSubagentJobs`（`src/util/subagents.ts:26`）过滤条件一致：`kind="subagent"`、`status=running|completed|error|cancelled`、`childSessionID` 必填。
- `client.jobs()`（`src/opencode/client.ts:231-236`）已传 `descendants=true`，注释注明 2.3.0 实测通过。
- 轮询在 `sendNow()` 内 `busy=true` 后启动（`src/webview/panel.ts:585-589`），间隔 2s。
- `safeCall` 失败会 post `error` 消息（`panel.ts:406-412`），webview 显示红色横幅。用户复现时**未见到**错误横幅。

## 无法建立的端到端反馈环

扩展连自身 spawn 的私有 server，端口随机、Basic 密码为扩展进程内存内随机值（`src/server/manager.ts:171`）。实测：

- 本机 `127.0.0.1:2713`（`opencode.exe serve --port 2713`）对空密码、Bearer、`OPENCODE_PASSWORD` 环境变量值均返回 401。
- `~/.local/share/opencode/log/opencode.log`（35MB）中 `/api/experimental/job` 仅 1 条记录，且是我自己的探测请求，说明扩展 server 不写该日志。
- 环境变量 `OPENCODE_PASSWORD` / `OPENCODE_SESSION_ID`（`ses_e1f48880effetTZDO19FL0b4in`）属于当前 TUI 会话，对 2713 无效。

## 假设

Bug 1：

- H1 job 列表返回空（状态窗口或 descendants 未生效）。
- H2 `/api/experimental/job` 在该 server 上 404 —— 已被"无错误横幅"弱排除。
- H3 `state.sessionID` 与消息 `sessionID` 不匹配被丢弃（`webview-ui/state.ts:298`）。

Bug 2：

- H4 主会话有运行中子代理时 `interrupt()` 不产生 `session.execution.interrupted`，`pendingForce` 悬空（`panel.ts:669-671`、`1185-1189`）。
- H5 `abort()` 清空 `pendingForce` 与 force 路径抢状态（`panel.ts:700-703`）。
- H6 架构约束：`task` 未返回前主 turn 必然 busy。

## 已落地改动

Bug 3（已实现，待验证）：

- `src/webview/protocol.ts`：`Snapshot` 与 `sessionMeta` 消息新增 `isSubagentSession?: boolean`。
- `src/webview/panel.ts`：新增字段 `private isSubagentSession = false`；`refreshSessionMeta()` 用 `getSession().parentID !== undefined` 赋值；`createSession()` / `switchSession()` 重置为 false；`sessionMeta` 与 `postSnapshot` 均下发。
- `webview-ui/state.ts`：`State` 新增 `isSubagentSession: boolean`，初始 false，`applySnapshot` 与 `sessionMeta` 分支消费。
- `webview-ui/app.tsx`：`QueueStrip` 与 `Composer` 外层包 `{!state.isSubagentSession && (...)}`。

临时探针（待清理）：

- `[DEBUG-sub1]`：`refreshSubagents()` 每次轮询打印 job 数量与每项 `kind/status/sessionID/child`。
- `[DEBUG-force1]`：`forceQueued()` 入口打印 `id/found/busy/sid`；turn-end 分支打印 `wasBusy/pending/type`。

清理方式：`grep -r "DEBUG-sub1\|DEBUG-force1"` 后整行删除。

## 产物

`dist\opencode-vscode-0.4.11.vsix`（268.75 KB，18 files）。
