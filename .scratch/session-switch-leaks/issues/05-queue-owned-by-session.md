# 05 队列状态归会话所有:键控化 + 后台排水随会话

Status: ready-for-agent
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
