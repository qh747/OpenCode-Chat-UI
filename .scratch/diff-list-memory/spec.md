# Spec: diff 列表的已处理记忆(dismissed 按会话 + 新回合不清 + added 行磁盘真相)

日期:2026-11-18。来源:grilling 会话(全部决策已与用户确认)。批次:0.4.22,与 `session-switch-leaks` issue 05 同批落地。统一原则见该 spec 开篇「会话绑定状态」。

## 背景(三个症状,一个根因族)

- **主报告**:A 会话撤销 agent 新建的文件后(盘上文件已删、行正常消失),切到 B 再切回 A,该行**又出现**在 A 的列表里——幽灵行。
- **同族 1**:撤销过的行,在 A 里发新消息后无差别复活(`sendNow` 每个新回合清记忆)。
- **同族 2**:B 显示 A 创建的文件——归因集被服务器写宽,**本批不修**,靠 added 行磁盘真相兜底压住 added 形态;根因调查见 `.scratch/server-snapshot-attribution/`(Q11 立项)。

## 事实(代码审计 + 用户确认)

- 撤销成功路径有记忆:`revertFile` → `dismiss(file)` 记 pre-revert 签名(`panel.ts:2094` → `1826-1829`)。
- 但 `dismissed` 是 panel **全局**字段(`panel.ts:89-94`),`switchSession:565` 一刀 `clear()`——**切走即失忆**;切回后 `refreshDiffs` 重取服务器历史 diff(不可变,原样吐回),归因集合法含该文件(A 的 agent 确实创建过)→ 复活。复现时序(Q5):切回瞬间出现。
- 清除点共 4 处:`createSession:517` / `switchSession:565` / `sendNow:635` / `rewindTo:1048`。`a89e1aa` 删除 keepFile handler 后,`dismiss` 只有 `revertFile` 一个调用方。
- 窗口重载重建 `ChatController` → 记忆清零(added 行由磁盘真相兜底;modified/deleted 复活为已知局限)。
- 服务器历史 diff 不因扩展写盘而变;行签名 `status:additions:deletions`(`panel.ts:2191-2194`),撤销后服务器仍报同签名 → 签名记忆可跨刷新存活。
- `dismiss` 用原始路径字符串做键,`refreshDiffs` 过滤用 `diffFileKey` 归一化——两套键,顺手统一。
- 无任何 fs 存在性检查(diff 路径全程无盘上校验)。
- 环境:0.4.21 新构建;B 跑过回合;复活行与撤销前同签名;文件确认不在盘上、未被重建。

## 决策

- **Q6(语义)**:签名隐藏持续有效——撤销后任何刷新/切换不再吐出;只有本会话 agent **再次改动同一文件**(签名变化)才重新出现。
- **Q8(边界)**:内存签名记忆 + **added 行磁盘真相兜底**。`refreshDiffs` 过滤链中对 `status=added` 的行检查盘上存在性,文件不在盘上 → 不显示。`deleted` 行**不适用**(文件不在盘上恰是其「待处理」常态,恢复它才是待办);`modified` 无法廉价校验,不查。**不做** workspaceState 持久化——单独给 Revert 持久化与内存语义不对称;要持久化应连 Keep 语义一起,另立项。
- **Q9**:删 `sendNow:635` 的 `dismissed.clear()`——新回合不再无差别复活;签名机制自足(agent 真的又碰 → 新签名 → 重现)。
- **Q10**:`dismissed` 改**按会话 park**(与 `sessionQueues` 同款模式):`switchSession` 用存/取替代 clear;`createSession` 的 clear 改为「泊出旧会话、新会话载入空表」;`rewindTo:1048` **保留** clear(倒带动了会话历史基准,重新开始合理);`deleteSessionById` 顺带清该会话 parked 记忆。
- **Q12**:ADR-0012「Diff list 的信任边界」。

## What was implemented

(实施后填)

## Open

- 窗口重载后已撤销的 modified/deleted 行可复活(内存记忆边界)。
- B 侧串行根因(服务器 `snapshot.files` 写宽)待 `.scratch/server-snapshot-attribution/` 调查结论。
