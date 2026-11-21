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

## 增补(2026-11-19,研究结论并入):归因 credibility 校验(Q21 = 并入本批)

`server-snapshot-attribution/01` 已 resolved,实证(详见其 Answer):`snapshot.files` 的真实语义是**该 assistant 消息自身窗口内共享工作树的内容变化**,不是「本会话 agent 碰过的文件」——扩展自己的 revertFile 写盘、别的会话的写,只要落进 B 某条消息的窗口,就被记进 B(`tools:[]`);B 行实际形态钉死为 `deleted +0 -4`(并发创建变体 `modified +1 -1`)。

- **决策 Q21(2026-11-19,与用户确认)**:归因加固**并入本批**(issue 04),与 `session-switch-leaks` issue 05 并行(区域不相交)。
- **规则(窄校验,零漏报风险)**:`attributionSet` 跳过 **`tools` 为空**的 assistant 消息声称的文件——没调用过任何工具的消息无权认领文件;`tools` 非空的消息照旧全量归因(真写必经 tool)。已知二阶局限:某条 tools 非空的消息窗口恰好框住外来写 → 仍可能串行;观测到再升级为 tool-input 逐文件交叉(那才有「bash 变量路径写法漏归因」的代价,本批不付)。
- 顺带:`src/opencode/types.ts:168-173` 的服务器契约注释按研究结论改写(原「files names the files the turn touched」不成立);ADR-0008 追加修订节;GLOSSARY「Attribution set」词条修订。

## What was implemented

(0.4.22 批次,与 `session-switch-leaks` issue 05 同批;三票独立分支 TDD 落地,合入集成分支 `batch/0.4.22-session-bound-state`。)

- **01(dismissed 按会话 park)**:新 `src/webview/session-dismissed.ts`(`SessionDismissed`,与 `SessionQueues` 同款 stash/take/drop——泊位克隆、取走即消、空表擦泊位);`panel.ts` 增 `sessionDismissed` 字段与 `stashDismissed`/`loadDismissed`,`switchSession`/`createSession` 泊出载入替代 `clear()`,`deleteSessionById` 与 `session.deleted` 两路顺带 drop parked;`dismiss`/`visibleDiffs` 键统一走 `diffFileKey`;`rewindTo` 的 clear 按决策保留。测试:`test/dismissed-memory.test.ts`(13 条,含「切走切回保持隐藏」「会话删除清理」「签名变化重现」);实施者自纠一例空洞通过——switchSession 本身清空 diffs 会让断言平凡为真,改为模拟切回后 refreshDiffs 重取同签名历史 diff。
- **02(新回合不清)**:`sendNow` 删 `this.dismissed.clear()`,留三行注释引 spec 决策 Q6/Q9。测试:`test/diff-send-memory.test.ts`(3 条:新回合不复活、签名变则重现、同签名刷新保持隐藏)。
- **03(added 行磁盘真相)**:`refreshDiffs` 过滤链改为单趟:归因过滤后对 `added` 行做 `fileOnDisk` 存在性检查(同一 `resolveFileUri` 路径),盘上无文件即弃;`deleted`/`modified` 不受影响。测试:`test/diff-disk-truth.test.ts`(4 条:幽灵 added 不显示、盘上有文件不过滤、deleted 行豁免、链序)。
- 支撑:`test/vscode-stub.ts` 扩 `workspace.fs.stat`、可注入 `showWarningMessage`、`getConfiguration`;新测试文件均注册进 `test/run.ts`。
- 全量:337 通过 0 失败 1 跳过(既有跳过:Windows 盘符路径用例);typecheck / lint 过。

## 增补(2026-11-22,归属反转:同族 2 收尾)

per-file cross-check(2026-11-21)落地后用户仍复现 B 串入 A 的文件:豁免通道(shell/patch/execute 全量、tools 缺失全量、write 缺 path 全量)正是最后入口,per-file 收窄收不到它。决策(用户拍板 Q1/Q2):

- **归属反转**:`attributionSet` 只认本会话 write/edit 的 `input.path`(双通道并集),`snapshot.files` 整体退出归属判定,豁免机器全删——B 没发过写调用 → B 列表必空,同族 2 结构性关闭而非过滤修补。
- **竞态封堵**:`refreshDiffs` 在 added 行磁盘校验 await 之后、赋值之前补第三次 pollStale 复查(切换落进该窗口时,迟到的 poll 曾污染 host 状态并经快照以 B 的身份扇出)。
- **拍板代价**:shell 重定向等不可见写盘的改动漏显示(以假阴性换零串扰,验收口径里不算回归)。

TDD 先红后绿(用户场景端到端 + 竞态窗口两条新锁定测试,4 处旧豁免契约反转,7 处主题无关 fixture 仅补 write 调用),code-review 两轴评审后修正修订计数引用与陈旧注释。全量 489 pass / 0 fail,typecheck / lint 过。详见 issue 04 追记(2026-11-22)与 ADR-0008「Revision (2026-11-22): ownership inversion」。

## Open

- 窗口重载后已撤销的 modified/deleted 行可复活(内存记忆边界)。
- ~~二阶串行形状(tools 非空的消息窗口框住外来写)未防~~ **已关闭(2026-11-22)**:tool-input 逐文件交叉后用户仍复现,升级为归属反转,豁免通道全删,同族 2(B 显示 A 的文件)随之结构性关闭——见「增补(2026-11-22)」节与 issue 04 当日追记。
