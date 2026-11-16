# 04 子代理完成后绿点/三点残留

Status: resolved
Type: task

按 spec 分支 4 实施。验收：`switchSession()` 重置 `this.busy=false`；`refreshSessionMeta()` busy 双向重算；`postHistory` 戳记保留；`deriveSessionStatus` 不加启发式。

## Comments

### 2026-11-17

- `switchSession()` 开头补 `this.busy = false`（若新会话真在跑，fullResync → refreshSessionMeta 会重新置位）。
- `refreshSessionMeta()` 改双向重算 `this.busy = Boolean(time.busy) && !time.idle`（服务器 busy/idle 为唯一事实）。
- `postHistory` activeIDs 戳记与 `deriveSessionStatus` 保持不动（符合决策）。
- typecheck / 232 测试全绿。

