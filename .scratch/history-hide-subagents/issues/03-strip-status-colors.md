# 03 strip 状态色:running/blocked/error + 失败行 30s 钉住

Status: resolved
Type: task
Blocked by: —

按 spec D4 实施。strip 行获得状态：running（现状蓝脉冲）、blocked（黄，等权限）、error（红，钉 30s）。host 在 strip 刷新周期附带子会话 pending permission 供阻塞判定。

## 改动

1. **`src/util/subagents.ts`**：
   - `SubagentJob` 增加 `status: "running" | "blocked" | "error"`、`ended?: number`（error 行冻结耗时）。
   - `toSubagentJobs(jobs, blockedIDs?)`：保留 `kind==="subagent" && childSessionID && (running || error)`；status 映射——error→`"error"`（ended 取 `time.completed`）；running 且 `blockedIDs?.has(childSessionID)`→`"blocked"`；否则 `"running"`。cancelled/completed/shell/image 依旧丢弃。
2. **`src/webview/panel.ts`** `refreshSubagents`：jobs 非空时与 `pendingPermissions` 并发拉取（失败静默为空集），把 `childSessionID` 命中的会话 id 集合传给 `toSubagentJobs`；注释记录「子代理权限挂主会话名下则 per-row 黄退化」的活体观察待办。
3. **`webview-ui/SubagentStrip.tsx`**：
   - 行 class `subagent-row is-${job.status}`；failed 行渲染**无 Stop**；elapsed 用 `job.ended ?? clock`（失败冻结）。
   - 30s hold：组件本地 `held` Map（id → {job, until}）；error 行出现即记 `until = now + 30_000`（续期）；从服务器列表消失后按 hold 继续渲染到过期；`currentSessionId` 变化即清空（会话作用域）。
   - 渲染行 = live 行 + hold 中已消失未过期的行（去重按 id）；head 计数按渲染行数；head 着色——任一渲染行 failed → `is-failed`，否则任一 blocked → `is-blocked`；不强制展开。
4. **`webview-ui/styles.css`**：`.subagent-row.is-blocked .subagent-dot`（黄，保留脉冲）、`.subagent-row.is-failed .subagent-dot`（红，停脉冲）、`.subagent-row.is-{blocked,failed} .subagent-agent`（黄/红）、`.subagent-head.is-{blocked,failed} .subagent-count`（黄/红）。

## 测试缝（TDD）

- 红：`toSubagentJobs`——running→running、blocked 命中→blocked、error→error+ended、cancelled/completed/shell 丢弃、缺省 blockedIDs 全 running。
- 红：`SubagentStrip` 静态渲染——failed 行 class + 无 Stop + 有 open、blocked 行有 Stop、head `is-failed`/`is-blocked` class。
- 红：30s hold——（jsdom 真实计时或注入时钟）error 行从 jobs 消失后仍渲染、过期后消失、切会话即清。
- 既有 `test/subagent-refresh.test.ts` / `test/subagent-nav.test.tsx` 不回归（stop/open 协议面不变）。

## 验证

- typecheck / lint / 全量测试。

## Comments

- 2026-11-21 完成实施。实施差异三处：① 行 class 词汇统一——`SubagentJobStatus` 是 `"error"`（沿用服务器 JobStatus 词），但渲染 class 用 `is-failed`（与历史行 `status-failed` 的语义色对齐），组件里做一次映射；② hold 用例按仓库 jsdom 惯例重写为**同步 act**（async act 走 React scheduler 的 MessageChannel，端口把 node 事件循环挂住、进程无法退出，二分定位后按 subagent-nav 的 mount 支架改）；③ `HOLD_MS` 从组件导出供测试引用（单一真源）。`subagent-refresh.test.ts` 的 stub 补新接缝（pendingPermissions + host.folderPath），并新增「子会话权限 → 行 blocked」接线用例。全量 464/463/0。
- 2026-11-21 code-review 修正：① hold 从「首见冻结」改回工票正文的**续期**语义（在列期间 seenAt 随最后一次见到续期，30s 从服务器真正移除那刻起算；原实现若服务器留存超 30s 后才移除，兜底会落空）——新增「列表里挂着时续期」用例红→绿锁定；② 修 `ended` 注释超售（`time.completed` 缺省时耗时退回时钟继续走表，属边缘、注释如实并挂运行时观察）；③ Standards 轴去重——panel 的两次 `toSubagentJobs` 调用收敛为单次 + `withBlocked`（blocked 语义单源，`toSubagentJobs` 内部亦经它），strip 的过期谓词抽 `isHeldExpired` 单源。记录不改：两个日期分组函数同形（各自输入类型，私有 groupByDate 已共享）；status→class 词汇映射单点存在；测试 mount 支架与 subagent-nav 同构（仓库惯例每文件自持）。
- 待活体观察（运行时）：子代理权限请求挂谁的 sessionID（挂主会话则 per-row 黄退化，组件注释已记录）；error 态作业在服务器列表的留存时长（30s hold 不依赖它）。
