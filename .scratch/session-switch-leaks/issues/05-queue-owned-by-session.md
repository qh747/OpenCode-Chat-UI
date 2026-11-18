# 05 队列状态归会话所有:键控化 + 后台排水随会话

Status: resolved
Type: task

按 spec 分支 5 实施(Q17/Q19/Q20)。**分阶段 TDD,每阶段先红后绿,全程 `npm run typecheck` 随改随跑。**

## 阶段 1(红→绿):EMPTY 别名修复

- 红:「A 排队 → 切到 B → B 的队列条为空,且不向 B 发送任何消息」(端到端,走真 `switchSession`,不 stub `drainRestoredQueue`——现测试把它 stub 成 no-op,`test/session-switch.test.ts:66`,需重写)。
- 绿:`SessionQueues.take()` 两个空分支(`session-queues.ts:47,51`)返回**全新**快照(`{ items: [], paused: false }` 字面量,不得引用模块级 `EMPTY.items`);补单元测试:「连续两次 take 空泊位返回相互独立的新数组」「向 take 返回的空数组 push 不影响后续 take」。

## 阶段 2(重构,保持绿):键控化

- 队列状态 `{ items, paused, pendingForce }` **只**存在于 `SessionQueues`,按会话键存;对外只暴露按会话的方法(`state/push/shift/unshift/remove/setPaused/setPendingForce/drop`),返回新副本,调用方一律通过方法变更——**禁止**再交出内部数组引用。
- `panel.ts` 的 `this.queue` 退化为当前会话的只读视图(getter 或等价物);`this.queue.push/shift/filter` 等直接变更(`:597`、`:678`、`:712`、`:743`、`:763`)全部改为方法调用。
- 删除 `stashQueue`(`:770-776`)/`loadQueue`(`:779-784`)/`drainRestoredQueue`(`:786-805`)及其调用(`:550`/`:566`/`:576`);`switchSession` 只剩:翻 `sessionId` → 清 UI 态 → `postQueue()`(新会话视图)→ 早快照 → `fullResync`。
- **阶段 2 过渡**:保留「切回时若目标会话空闲则排水其队列」的语义(现 `drainRestoredQueue` 的职责),以按键解析实现(对 `this.sessionId` 的 map 状态排水),阶段 3 落地后删除该切换时排水。
- 全部发送路径带**显式所属会话参数**:`sendNow(text, attachments, sessionID)`、`startQueued(item, sessionID)`、`drainQueue(sessionID)`、`forceQueued/resumeQueue` 解析目标为盖章守卫后的 `this.sessionId`;`client.prompt`(`:658`)不再使用裸 `this.sessionId`。
- `postQueue`/早快照读当前会话视图(带 `sessionID` 标签,现状已带)。

## 阶段 3(红→绿):后台排水随会话(Q17-A)

- 红:「A 忙时排队 → 切到 B → A 的回合在后台结束 → 消息发给 **A**、B 无任何动静」「切回 A 不重复发送」「A 回合后台失败/中断 → A 的队列转为暂停(规则与前台一致),pendingForce 随所属会话走」。
- 绿:把回合结束的队列处理块(`panel.ts:1313-1329`)抽为按会话参数化的 `handleTurnEndQueue(sessionID, outcome)`:pendingForce → 以该会话为目标启动;失败/中断 → 该会话队列置 paused;成功 → shift 队头并以该会话为目标启动(FIFO 链不变)。显示相关副作用(busy 复位、UI 刷新、`scheduleMessagesRefresh`)**仍**守在 `eventSession === this.sessionId` 内;队列排水部分对任意会话生效。删除阶段 2 的切换时过渡排水。
- 重写 `session-queues.ts:22-28` 的 park-and-return 设计注释为 Q17-A 语义。

## 收尾

- 会话删除清该会话队列状态:`deleteSessionById`(`:1114-1123`)与 `session.deleted` 事件路径(`:1406-1421`)调用 `drop(sessionID)`(与 diff-list-memory issue 01 的 parked dismissed 清理同点,注意合并顺序)。
- 协议硬化:广播类消息(`subagents` `protocol.ts:158`、`diffs` 等 host→webview 消息)的 `sessionID` 由可选改**必填**(编译期堵死守卫对 `undefined` 不设防的潜在弱点;相应收紧 webview reducer 无需变——类型保证后守卫可简化)。
- 既有测试迁移:`test/session-queues.test.ts`(take 语义用例改为新 API)、`test/session-switch.test.ts`(泊位断言改为键控状态断言)、`test/queue.test.ts` / `test/queue-strip.test.ts` 应保持绿。

## 验收汇总

1. A 排队 → 切 B:B 条空、不发送(阶段 1);
2. 键控化后 1 保持绿,`prompt` 全部带显式会话参数(阶段 2);
3. A 回合后台结束 → 发给 A;失败/中断 → A 队列暂停;切回不重复(阶段 3);
4. 会话删除清队列状态;
5. 广播消息 `sessionID` 必填(编译期);
6. 竞态:盖章 B 的动作在切换 await 窗口内解析到 B 的队列(A 不受影响)——补一条测试钉住。

## Comments

### 2026-11-19(实施:ticket/ssl-05)

三阶段 TDD 完成,分支 `ticket/ssl-05`(基于 `batch/0.4.22-session-bound-state`,收尾并入该分支 tip,无冲突)。每阶段先红后绿,`npm run typecheck` 随改随跑,lint 收尾通过。全量:**355 通过 0 失败 1 跳过**(基线 338)。

**阶段 1(EMPTY 别名,commit f291859)**
- 端到端红:`a queue typed in A stays out of B: B's strip is empty and nothing is sent to B`(test/session-switch.test.ts,新 `queue does not leak across sessions` 组)。走真 `switchSession`,不再 stub `drainRestoredQueue`;harness 让 A 的活队列先经 `loadQueue` 空泊位分支取得 EMPTY 别名再排队,复现真实路径。既有早快照用例此前只因"从未有人向 EMPTY.items push 过"而碰巧绿(用例顺序脆弱),修复后全部转绿。
- 修复:`take()` 两个空分支返回全新 `{ items: [], paused: false }` 字面量,模块级 `EMPTY` 常量删除。
- 单元红(green 时一并转绿):`two empty-berth takes hand out independent fresh arrays`、`pushing into a returned empty snapshot never affects later takes`(test/session-queues.test.ts)。
- 备注:`assert/strict` 的 `deepEqual` 带 `asserts actual is T` 签名,会把 actual 收窄到期望字面量类型——测试里先 push 再断言以规避。

**阶段 2(键控化,commit fe6691c)**
- `SessionQueues` 重写为按键 API:`state/push/shift/unshift/remove/setPaused/setPendingForce/drop`;`state()` 一律交出新副本(cloneSnapshot),空读返回新字面量;条目在"无 items 且无 pendingForce"时归一化删除。类注释同步改写(阶段 3 再落 Q17-A 终稿)。
- `panel.ts`:`this.queue` 退化为当前会话键控状态的只读 getter;`queuePaused`/`pendingForce` 字段删除;`stashQueue`/`loadQueue`/`drainRestoredQueue`/`resetQueue` 删除;发送路径带显式所属会话:`sendNow(text, attachments, sessionID)`(prompt 不再用裸 `this.sessionId`)、`startQueued(item, sessionID)`、`drainQueue(sessionID)`;`forceQueued`/`resumeQueue`/`removeQueued` 解析目标为盖章守卫后的 `this.sessionId`;`postQueue(sessionID)` 显式带标签;`postSnapshot` 读当前会话视图。
- **过渡决定**:按键解析的 `drainSwitchedQueue(sessionID)` 保留旧 `drainRestoredQueue` 语义(切回时目标会话空闲则排水,pendingForce 转回队头),阶段 3 落地后删除。
- 会话删除清队列状态:`dropQueueState`(drop + 附件释放)落在 `deleteSessionById` 两分支与 `session.deleted` 两分支,与 dl-01 的 `sessionDismissed.drop` 同点组合、未互踩。
- 测试迁移:`test/session-queues.test.ts` 全量重写为新 API(行为钉保持:跨会话独立、FIFO、空读新字面量、drop 清理、副本不出逃、pendingForce 克隆);`test/session-switch.test.ts` harness 迁移(自有 `get queue()` 只读视图、排队消息直接 `sessionQueues.push`)、"parked before the flip" 改为键控状态断言 `the outgoing session's queue stays in its own keyed state across the flip`;`test/dismissed-memory.test.ts` 三个 fake 迁移;queue/queue-strip 保持绿未动。

**阶段 3(后台排水随会话 Q17-A,commit bbc5159)**
- 新文件 `test/queue-turn-end.test.ts`(6+1 用例,注册进 run.ts),红→绿:
  - `A's turn ends while B is displayed: the message goes to A, B stays quiet`;
  - `switching back to A afterwards does not re-send the message`;
  - `a background failed turn pauses A's queue, rules matching the foreground`;
  - `an interrupted turn's pendingForce starts against its owning session`;
  - `an end-of-turn event burst drains exactly one queued message`;
  - `a turn end for a session the panel never saw running leaves its queue alone`;
  - 前台钉:`the displayed session's turn end still drives its own queue`(FIFO 链存活)。
- 绿:回合结束队列块抽为 `handleTurnEndQueue(sessionID, outcome)`(返回是否启动新回合,显示侧据此决定补不补消息刷新);显示副作用(busy 复位、通知、settleSubagents、scheduleMessagesRefresh/sessionMetaRefresh/refreshDiffs)仍守在 `eventSession === this.sessionId` 内,后台分支只推进该会话队列。`sendNow`/`failTurn` 的显示态副作用按目标会话守卫(后台失败不污染显示)。类注释重写为 Q17-A 语义。
- **新增机制(工票未点名,实施补齐)**:`runningTurns` Set(会话 → 在跑回合 latch)。动因:回合结束事件成簇到达(idle + execution.*),前台靠 `this.busy` 去重,后台无对应物——无 latch 会并发启动两条回合。转移:sendNow 在 prompt 被服务器接受后登记(拒绝不登记)、`session.step.started`/`execution.started` 对任意会话登记、回合结束事件消费一次(消费成功才排水)。`drainQueue` 的在跑判定跟随目标会话(显示会话用 `this.busy`,后台用 latch)。队列状态、显示 busy 谓词(Q7)均未受影响。
- **过渡排水删除**:后台回合结束已按时排水,切回不再承担恢复职责。已知取舍:事件流丢失回合结束事件时该会话队列滞留,直到用户下一次动作(发送/恢复);与事件流有损、重连即全量 resync 的既有约定一致,未另建 meta 触发排水(会与 prompt 在途窗口竞态)。
- 竞态钉(验收 6):`a queue action stamped B inside the switch window resolves against B's queue; A is untouched`(test/session-switch.test.ts)。

**收尾(协议硬化,commit 1464015)**
- `busy`/`queue`/`forms`/`subagents`/`permissions`/`diffs` 六条 host→webview 广播的 `sessionID` 改必填;webview reducer 六个守卫收紧为严格比对。**范围决定**:`imageStaged`/`fileResults`/`pickedPaths` 保持可选——请求/响应类消息允许在无会话时发出(会话建立前的附件检索/拾取),强制必填会砍掉该流程;`sessionMeta` 保持可选(pending 拾取选择在无会话时合法落 post)。
- 落点:refreshPermissions/refreshForms 取守卫后局部常量;broadcastDiffs 参数化;事件路径用 eventSession;clearForms/clearSubagents 以 `?? ""` 兜底(webview 守卫丢弃,比旧 undefined 通道更严)。

**复核提示(给 merger)**
1. `runningTurns` 是工票"抽 handleTurnEndQueue"之外的实施级补齐,语义如上;若后续有人以 per-session busy 缓存之名质疑,请对照 Q7(那是显示谓词的取舍)与本 latch(队列排水去重)的分工。
2. 显示会话回合结束的队列排水门槛从 `wasBusy` 改为 latch 消费:服务器侧发起且 `step.started` 事件丢失的回合结束时不再排水(旧行为会)——超低概率、事件流有损场景,取舍记录在案。
3. 阶段 1 的红暴露过一批"碰巧绿"的既有用例(EMPTY 全局污染跨用例),均已随修复转绿,无删用例。
4. `switchSession` 的早快照后不再有任何排水调用;若日后出现"切回即想立即送"的新诉求,请在 Q17-A 的事件驱动模型上立项,不要恢复泊位机制。

### 2026-11-19(code-review 修复轮:ticket/fix-review)

**发现(sendNow 缺显示态守卫)**:`sendNow` 无条件置位 `this.busy`、复位 `turnFailed`、把乐观气泡推进 `this.messages`(显示会话的转录)、启动权限/子代理轮询——后台排水(B 显示且空闲,A 的队列在后台启动回合)因此锁死宿主 busy:B 的下一条消息被 `send()` 扣进 B 的队列,而 B 没有回合在跑、没有恢复入口,消息永久滞留;A 的气泡同时污染 B 的转录。

**修复(commit 9bfd56d)**:sendNow 以 `displayed = sessionID === this.sessionId`(目标 === 显示)一道闸门收拢全部显示态副作用:busy/turnFailed/busy 广播、轮询启动、乐观气泡、messages 广播、`recordModelUsed`(喂显示会话 picker 的 Recent,后台回合记 `this.model` 会把 B 的 picker 选择记到 A 头上)、以及选区 auto-attach(选区属于显示会话的用户上下文,不得随后台回合捎带)。队列/回合机制对任意会话无条件:`client.prompt`、`runningTurns` latch、staged 附件释放。`failTurn` 的既有守卫(队列簿记无条件、显示态按 `sessionID !== this.sessionId` 早退)与该形状一致,未动。审计延伸:`drainQueue`/`handleTurnEndQueue` 里的 `postQueue`/`setPaused` 广播保留无条件——它们带所属会话标签,外来 webview 守卫丢弃,是队列簿记而非显示态。

**测试重缝(空洞性修复,必做项)**:原测试缝 stub `startQueued`,sendNow 从未在后台路径跑过,`assert.equal(controller.busy, false)` 空转通过。现缝移到 `client.prompt`(发送归属的真边界):test/queue-turn-end.test.ts 的 fake 携带真 `sendNow/startQueued/drainQueue/handleTurnEndQueue/postQueue`,只 stub client(prompt 记录目标会话/正文/附件)与显示侧定时器依赖(轮询为 spy)。新增用例(describe `a background delivery leaves the displayed session alone`):
- `a background delivery while another session is displayed leaves the displayed session idle and clean`(红→绿:busy 保持 false、B 转录不进气泡、轮询不被拉起、picker Recent 不被写、A 的 prompt 正文不带 B 的选区);
- `the user can still send immediately in the displayed session after a background delivery`(红→绿:B 的消息直接成为回合而非入队——锁死后果的钉子;修后 B 自己的回合正常置位 busy)。

既有断言随缝迁移转真: `A's turn ends while B is displayed: the message goes to A, B stays quiet` 的 `busy === false` 与「发送归属」不再空转;前台钉 `the foreground FIFO chain survives` 新增选区 auto-attach 与 recordModelUsed 的前台存活断言。修复前红 3 条(全部命中泄漏本身),修复后全绿。

**计数**:`npm test` 358 tests / 357 pass / 0 fail / 1 skipped(基线 355/354/1;+2 新用例 +1 dl-03 用例);`npm run typecheck`、`npm run lint` 通过。
