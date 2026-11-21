# Spec: 会话历史行状态聚合色

日期：2026-11-18。来源：grilling 会话（决策已确认；权威记录另见 plan 文件 `~/.opencode/plan/session-switch-leaks-0.4.21.md`）。

## 现象

子代理执行任务时，主会话在历史菜单里**折叠行显示红色**，展开主会话后主会话行显示绿色。期望：只要子代理没有阻塞等待用户操作，无论折叠还是展开，主会话都应显示绿色。

## 根因

- `HistoryMenu.tsx:109-112`：折叠行只要 `runningChildren > 0`（`sessions.ts:72`，只数 `status === "working"` 的子代理）就挂 `has-running-children` 红色警示；展开时去掉该类，只剩主会话自身状态色（主 idle → 无色，主 working → 绿）。
- 该行为源自 2026-11-17 的诊断决策（代码注释 106-108："红色警示只给折叠行：展开时子代理行自带状态色，红色警示反而与失败撞色"）。
- 另外展开行不做聚合：主会话 idle + 子代理在跑 → 展开行无色，而非绿色。

## 决策（Q11，推翻 2026-11-17 决策）

主会话行（折叠、展开一致）改为**聚合行状态**，按优先级：

1. 任一方（主会话或任一子代理）**blocked 或 failed → 红**（"需要你介入"统一用红）；
2. 否则任一方 **working → 绿**（子代理在跑 = 绿，主会话在跑 = 绿）；
3. 否则无色（idle）。

- 子代理行自带状态色不变。
- `· N running` 计数文字保留（`runningChildren` 字段保留）。
- **推翻 2026-11-17 "子代理在跑 → 折叠行红"的诊断决策**；`.has-running-children` class 与其 CSS 规则删除，106-108 注释重写为新规则与推翻记录。
- 对应 ADR：`docs/adr/0010-history-row-aggregate-status.md`。

## 实施

- 纯函数 seam：`sessions.ts` 新增 `aggregateRowStatus(root, children)`，`test/sessions.test.ts` 补单测（TDD）。
- `HistoryMenu.tsx`：有 children 的行用聚合状态挂 `status-*` class。

## 验证

- `npm run typecheck`、`test/sessions.test.ts`、全量 `npm test`。
- 人工验证：折叠/展开两态下子代理运行 → 绿；子代理阻塞 → 红；全部空闲 → 无色。

## Comments

### 2026-11-18

- TDD：`test/sessions.test.ts` 新增 `aggregateRowStatus` 六条单测（working 子代理 → 绿；blocked/failed 子代理 → 红；attention 优先于 running；全 idle → 无色），红灯确认（导出不存在，编译红）。
- `sessions.ts` 新增纯函数 `aggregateRowStatus(root, children)`：blocked/failed → `"failed"`（单一警示红），否则任一 working → `"working"`，否则 root 自身。根行自身的 blocked（黄）只作用于无子代理的行，不在聚合范围内。
- `test/history-menu.test.ts` 旧断言（折叠行红）按 ADR-0010 翻转并收紧为按父行 span 断言：折叠/展开两态父行均为 `status-working`；blocked 子代理 → 父行 `status-failed`。
- `HistoryMenu.tsx`：`has-running-children` class 逻辑删除，行状态改为聚合；106-108 注释重写为新规则与推翻记录。`styles.css` 删除 `.history-title.has-running-children` 规则。`runningChildren` 字段保留（`· N running` 计数仍用）。
- typecheck / lint / 全量测试通过（315 通过 0 失败）。

### 2026-11-21 推翻记录

本 spec 确立的聚合规则被 `.scratch/history-hide-subagents/` 推翻：历史菜单不再显示
subagent 会话（服务端 `parentID=null` 过滤 + 本地兜底），行状态只由主会话自身决定，
`aggregateRowStatus` 及其用例删除。对应 ADR-0016 取代 ADR-0010；子代理的阻塞/失败
信号改在聊天流 SubagentStrip 上表达（黄=等权限、红=失败钉 30s）。
