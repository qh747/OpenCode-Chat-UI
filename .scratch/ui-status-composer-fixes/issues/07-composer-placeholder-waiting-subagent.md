# 07 等待子代理时输入框显示默认提示

Status: resolved
Type: task

按 spec 分支 7 实施。验收：等待子代理窗口（主回合已结束、仅子代理在跑）placeholder 为默认文案；主会话真正处理中提示不变。预期主要依赖分支 4 的 busy 修复；实施时验证该窗口 `state.busy` 恒 false，有残留路径则补守卫。

## Comments

### 2026-11-17

- 核对结论：无需新增代码。placeholder 仅由 `state.busy` 驱动（Composer.tsx busy ? composerPlaceholderBusy : composerPlaceholder）。
- "等待子代理"窗口 = 父会话 idle + 仅子代理 job 在跑：issue 04 修复后 busy 在该窗口恒为 false → 默认 placeholder 自动达成。所有置 true 的路径（sendNow、session.execution/step.started 事件，后者要求 eventSession === 本会话）都对应主会话真实回合；子代理自身的执行事件 sessionID 为子会话，不影响 busy。
- 主回合真正处理中（含子代理随主回合在跑、steer 报告注入的短暂回合）→ busy=true → 提示完全不变（含"Enter 加入队列"），符合决策。

