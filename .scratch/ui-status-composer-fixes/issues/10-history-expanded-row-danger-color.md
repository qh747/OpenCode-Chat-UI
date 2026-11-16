# 10 历史菜单展开行误染 has-running-children 红色

Status: resolved
Type: task

来源：用户装 vsix 人工测试（0.4.11.vsix）反馈：折叠根行下子代理在跑时标题变红属 Q4 预期警示，但**展开**的根行也变红，且子代理行自身显示 working 绿色，红绿撞色误导为"主会话失败"。

## Comments

### 2026-11-17（诊断，diagnosing-bugs 流程）

- 红环：`test/history-menu.test.ts`（react renderToStaticMarkup）断言展开根行不含 `has-running-children`；原实现下该断言变红，复现用户确切症状。
- 根因：`HistoryMenu.tsx` renderRow 挂 class 只判 `fold.runningChildren > 0`，未判 `!isOpen`——警示色本意只针对"折叠行下有在跑子代理"。
- 修复：条件补 `&& !isOpen`；测试开口 `initialExpanded?: ReadonlySet<string>`、`initialOpen?: boolean`（生产不传行为不变）。
- 红转绿：236 用例 61 套件全绿，typecheck/lint 0 错。

### 2026-11-17（Phase 6）

- 复验：原复现场景（展开的根行 + runningChildren>0）由回归测试锁定。
- 探针：spec 明文暂留的 [DEBUG-sub1]/[DEBUG-force1] 保留，无新增探针。
