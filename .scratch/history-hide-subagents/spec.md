# Spec: 历史菜单隐藏 subagent 会话 + strip 状态色

日期：2026-11-21。来源：grilling 会话（六问 + 四问逐题拍板；活体验证同日完成）。

## 动机

历史菜单把 subagent 子会话**折叠**进主会话行（可展开查看子行），行颜色按 ADR-0010 **聚合**主会话与所有折叠子会话的状态。用户要求：菜单对 subagent 会话完全闭嘴——不显示、不折叠、不染色；委托活动的一切信号集中到聊天流 SubagentStrip。

决策链：2026-11-17 诊断决策「子代理在跑 → 折叠行红」→ ADR-0010 聚合色（2026-11-18）→ 本特性**再次反转**（只看主会话自身）。由新 ADR-0016 取代 ADR-0010。

## 活体事实（2026-11-21，opencode 2.3.2 探针）

- `GET /api/session` 的 `parentID` 过滤线格式是**字面量 `"null"`**：`?parentID=null` 只回根会话；空串 / 裸参数 / `undefined` 均 400（OpenAPI：`anyOf[Session.ID, enum["null"]]`，"Use null to return only root sessions"）。实测 baseline 6 行中 4 行是子会话——`limit:100` 名额污染真实存在。
- `GET /api/permission/request` 返回**全服务器**权限请求，`PermissionRequest.sessionID` 存在；子代理权限挂在谁的 sessionID 下**留待运行时观察**（探针时无挂起权限）。
- error 态作业在 jobs 列表的留存时长未测（ADR-0007：取消态一秒内离开列表）；strip 端 30s hold 不依赖服务器留存。

## 决策

### D1 菜单彻底隐藏（工票 01+02）

1. `listSessions` 增加 `parentID` 参数；历史菜单调用传 `"null"`（只取根会话，顺带修名额污染）。
2. 本地兜底一行：`rootSessions(rows)` 过滤 `parentID === undefined`——服务器忽略参数时仍正确。孤儿会话（parentID 指向页外）按「parentID 非空 = 非 root」一并隐藏，语义统一（与原 folding Q19 的孤儿保留语义不同，此处有意收紧）。
3. QuickPick 本就只显示根会话（`historyPicker.ts:41`），零改动。
4. 折叠机构全删：`foldSubagentSessions` / `rootFoldOf` / `rootToExpand` / `aggregateRowStatus` / `FoldedHistoryRow` / `groupFoldedByDate`，HistoryMenu 的 caret/子行/计数徽章/强制展开，`HistoryRow.parentID` 仅存于过滤用途。日期分组保留：`groupHistoryRowsByDate(rows)` 按行自身 `updated` 分桶（原「fold 后按 root 时间分组」的等价简化）。
5. i18n 删除 `historySubagentCount` / `historySubagentCountOne` / `historySubagentRunning`。

### D2 行颜色 = 主会话自身状态（推翻 ADR-0010）

- 行颜色 = `deriveSessionStatus(主会话)` 四态：working 绿 / blocked 黄 / failed 红 / idle 无色。
- **子会话任何状态不参与**：委托中主行无色（主 turn 等子代理时 `busy > idle` 不成立——ADR-0010 Context 记录的事实）；子代理阻塞/失败不再给主行染黄/红。主会话自身的 blocked/failed 照常。

### D3 当前会话是子会话 → 高亮主行

- app 层把高亮 id 算为 `isSubagentSession ? parentSessionID : sessionID`（`parentSessionID` 是直接父级，协议/状态已存在）；父级非根（深层嵌套）时无行可匹配、自然退化。**零协议增量**。

### D4 strip 状态色（工票 03）

- `SubagentJob` 增加 `status: "running" | "blocked" | "error"` 与 `ended?: number`；`toSubagentJobs(jobs, blockedIDs?)` 放宽为 **running + error**（cancelled/completed 继续丢弃：取消是用户自己的动作，完成品在转写 task 块里已有表达）。
- **失败行红**（`--danger`）：dot 变红停脉冲、agent 文字红、**隐藏 Stop**（没东西可停）、保留整行点击进子会话看转写。
- **阻塞行黄**（`--warn`）：dot 变黄保留脉冲、agent 文字黄、**保留 Stop**（停掉一个等权限的任务是合理操作）。
- 失败行**前端钉住 30 秒**：组件本地 hold、每秒 tick 自过期；服务器列表里消失也看得见；会话切换即清。复用当年 folding spec slice 2 批准过的 30s 机制（灰色完结行，从未实施）。
- 阻塞判定：host 在 strip 刷新周期附带拉取 `pendingPermissions`（**仅当有 job**），`p.sessionID === job.childSessionID` 命中即 blocked。子代理权限若挂主会话名下（待运行时观察），per-row 黄退化——届时回用户定夺。
- 折叠头计数随状态着色：任一行 failed → 计数红；否则任一行 blocked → 计数黄；**不强制展开**（折叠时红黄在头部计数可见）。
- 会话作用域不变（grilling S4）：红黄只在你看着那个主会话时可见；全局兜底是 VS Code 通知（权限默认开、错误默认关，本次不动）。

### D5 不加配置开关

默认硬行为。

## 测试缝（TDD）

- `client.listSessions` 线格式（`test/client-routes.test.ts`）：传 `parentID: "null"` → URL 含 `parentID=null`；不传则无该参数。
- `rootSessions`：根保留 / 子滤除 / 孤儿滤除（`test/sessions.test.ts`）。
- `groupHistoryRowsByDate`：按行自身时间分桶。
- `toSubagentJobs`：running→running、running+权限命中→blocked、error→error（带 ended）、cancelled/completed/shell/image 丢弃、缺省 blockedIDs 全 running。
- `SubagentStrip` 渲染：failed 行 class + 无 Stop + 有 open、blocked 行有 Stop、head 计数着色 class、折叠态着色可见。
- `HistoryMenu`：行状态直挂、无子行/caret/计数、高亮 id 传父级。
- reducer `subagents` 消息照旧（sessionID 守卫）。

## 验证

- typecheck / lint / 全量测试（基线 465）。
- 人工：真实服务器下菜单无子会话、委托时主行无色、子代理失败 strip 红行 30s、子代理阻塞 strip 黄行。

## 状态

- 2026-11-21 grilling 定案；同日活体验证 parentID 线格式（2.3.2：字面量 `"null"`）。
- 2026-11-21 实施收口：工票 01–03 全绿（typecheck/lint 干净、全量 464 项 463 过 0 失败），ADR-0016 落盘取代 ADR-0010，folding spec 补推翻记录，GLOSSARY 词条改写。待运行时观察两项见工票 03 Comments。
