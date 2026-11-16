# 01 会话历史状态圆点改为标题着色

Status: resolved
Type: task

按 spec 分支 1 实施。验收：历史菜单无任何状态圆点元素；标题按四态着色；折叠行 runningChildren>0 标题染红；动画全部移除；选中态下状态色优先；空闲态与普通会话一致。

## Comments

### 2026-11-17

- 实施完成。`HistoryMenu.tsx:102` 移除 `history-dot` 元素，标题 span 挂 `status-${session.status}` class；`:106-109` 移除 `history-subagent-dot`，折叠行标题在 `runningChildren > 0` 时挂 `has-running-children` class。
- `styles.css`：删除 `.history-dot*`、`.history-subagent-dot*` 全部规则与 `history-dot-pulse`/`history-dot-ring` 动画；新增 `.history-title.status-working/--warn/--danger` 静态色与 `.history-title.has-running-children`（`--danger`），声明顺序在 `.history-row.is-current` 之后使状态色优先。
- 宿主 `sessions.ts`/`panel.ts` 零改动，符合 spec。
