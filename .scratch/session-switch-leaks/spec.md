# Spec: 跨会话状态泄漏修复批次（diff 列表 / busy 状态 / 切换队列）

日期：2026-11-18。来源：grilling 会话（全部决策已与用户确认；权威记录另见 plan 文件 `~/.opencode/plan/session-switch-leaks-0.4.21.md`）。

## 背景

三个跨会话状态泄漏 bug，全部在带 0.4.20/0.4.21 未提交改动的构建上复现，且都落在这批新机制的缝隙上。修复叠加在当前未提交工作上，同批并入 0.4.21 收口。

## 统一原则(2026-11-18 二轮 grilling 后确立,批次 0.4.22)

**会话绑定状态(Session-bound state)**:会话态只属于会话,与当前显示的会话解耦。diff 列表、消息队列、subagent 作业同规——即使正在显示 B,A 的排队消息仍发给 A,A 的已处理记忆仍对 A 生效,A 的作业条既不串入 B 也不被 B 清掉。三条腿核查结论:

- **subagent 腿:已达标,无需修**(2026-11-18 审计:`pollStale` 双重守卫 `panel.ts:1686-1688` + 切换同步清空 `:568` + 广播带会话标签 + reducer 守卫 `state.ts:319-324` + stop 指向该行自己的 `childSessionID` `:1747`;`test/subagent-refresh.test.ts` 钉住)。潜在弱点:广播类消息 `sessionID?` 可选,守卫对 `undefined` 不设防——协议类型改必填,随 issue 05 顺手硬化。
- **diff 列表腿:有泄漏**(切换清记忆),见 `.scratch/diff-list-memory/`。
- **队列腿:有泄漏**,见下分支 5。

## 分支 1：diff 列表严格归因（Bug 1a）

- 现象：A 会话点改动列表某文件的 ×（revert）后，切到 B，B 的列表出现 `deleted a.md +0 -4`。复现事实：a.md 为 agent 新建、只有 A 碰过、× 后 A 正常消失、文件确实没了；**B 从没跑过回合（或只有纯聊天回合）**。
- 根因（`panel.ts:1791-1795`）：归因集（`touchedFiles`）为空时整个范围 diff **原样放行**：
  ```ts
  this.diffs = wanted.size > 0 ? result.data.filter(...) : result.data;
  ```
  B 重算列表（switchSession → fullResync → refreshDiffs）时，A 的 × 造成共享树变化被灌进 B，服务器如实上报 deleted。
- 决策 Q2：**空归因 → 空列表**（严格语义）。列表语义 = "本会话 agent 的待处理改动"；删除 passthrough fallback。会话没跑过回合/纯聊天回合就该是空的，自己的手工编辑本来也没有 before 内容可 Revert。
- 改法：`this.diffs = result.data.filter((diff) => wanted.has(diffFileKey(diff.file)));`
- 明确不做：服务器 `snapshot.files` 语义的调查（复现判定为空归因路径；若日后出现"有回合会话仍串行"的新证据再立项）。

## 分支 2：revertFile 加固（Bug 1b）

- 根因 1（协议）：× 发 `{kind:"revertFile", file}` 不带 sessionID；宿主以隐式"当前会话"执行，且本质是共享工作树写盘。
- 根因 2（损坏路径）：`modified` 路径 `reverseApply` 失败时（±3 行匹配窗口）把**原始 patch 文本直接写进文件**（`panel.ts:2006-2009 → 2044`）。
- 决策 Q3/Q4：
  1. `reverseApply` 失败 → **不写盘**、post 错误提示（i18n 新键 `revertConflict`）、文件保持原样；`deleted` 状态分支（重建目录写回 before 内容）同样守卫。
  2. `revertFile` 消息带 `sessionID`，宿主校验与当前会话一致才执行（与分支 4b 共用 handleMessage 入口的统一守卫）。

## 分支 3：busy 谓词唯一事实（Bug 2）

- 现象：A 在跑（方块按钮），切 B 再切回，A 错显发送箭头。
- 根因（`panel.ts:1842`）：`this.busy = Boolean(time.busy) && !time.idle`。opencode v2 的 `time.busy`/`time.idle` 是**持久 epoch 时间戳**：跑过回合的会话永远带旧 idle → 谓词恒 false。切回时全局 busy 已被清零（`:554`），唯一恢复源就是该谓词 → 快照 `busy:false`。
- 正确规则仓库已有：`sessions.ts:28-31`（`busy > idle` → working），测试钉住（`test/sessions.test.ts:29-33`）。
- 决策 Q7：谓词改为 `(time.busy ?? 0) > (time.idle ?? 0)`；**不**建 per-session busy 缓存、**不**统一 postHistory 的 activeSessions 来源。同根顺带修好 `drainRestoredQueue`（`:786`）与 `send`（`:583`）对在跑会话的误判。

## 分支 4：切换精神分裂窗口三件套（Bug 3）

- 现象：A 队列里的消息 1，切到 B 后立刻在 B 开跑（A 的队列被搬空）。
- 根因：`switchSession`（`panel.ts:545-568`）第 547 行即翻 `sessionId=B`、554 行清 busy，但 webview 要等 `fullResync` 结束（约 5 个 HTTP 往返后的快照，`:1879`）才翻页——期间 A 的队列条（msg1 + ↑）仍可点；`handleMessage` 无串行化（`view.ts:54`），`send`/`forceQueued`/`resumeQueue` 不带 sessionID（`protocol.ts:170-173`）；窗口内点击 ↑/Resume/Enter → 宿主以 `sessionId=B, busy=false` 执行 `sendNow` → `prompt(B, msg1)`。触发方式归档：点击 ↑ 或 Enter 落进窗口（用户确认的推荐读法；修法不依赖精确触发）。
- 决策 Q9（三件套）：
  1. **早快照**：`switchSession` 在同步清理完（loadQueue / clearForms / clearSubagents 之后）、`await fullResync` 之前先 `postSnapshot()`——webview 的 sessionID 立刻翻到 B，A 的队列条瞬间消失，stale-UI 窗口从 UI 侧关闭。接受"消息列表短暂空白"的视觉折价。快照 busy：原决策为"activeSessions map 尽力取值"，实施时确认 `activeSessions()` 是异步端点而早快照必须同步发出，故落地为**复位标志 + 快速纠正**（fullResync 里的 refreshSessionMeta 按 busy > idle 谓词在一个往返内置位；与 ADR-0009 拒绝在切回时查 activeSessions 的取舍一致）。
  2. **会话戳**：动作类消息带 webview 当前 `state.sessionID`，宿主不匹配即丢弃：send / removeQueued / 队列 force+resume / abort / formReply / formCancel / 权限应答 / stopSubagent / revertFile。webview 侧在 send 辅助函数**集中盖章**；`switchSession` 本身不盖。（removeQueued 与 force+resume 同属队列动作族，code-review 确认纳入。）
  3. **take() 删除 + 克隆**：`SessionQueues.take()`（`session-queues.ts:32-35`）不删除不克隆，驻留数组被别名共享；改为取出即删除 + 浅克隆（items 复制、pendingForce 复制）。
- 决策 Q10：**handleMessage 全局串行化暂不做**（三件套已覆盖已知竞态；真再撞上再立项）。

## 分支 5:队列状态归会话所有(Bug 4,0.4.22)

- 现象(0.4.21 构建上复现):A 忙时排队消息 → 切到 B → 消息被发到 B。
- **排错记录修正**:初判「后台回合结束的自动排水用了当前会话」**不成立**——回合结束排水整块被 `eventSession === this.sessionId` 守卫(`panel.ts:1292`),后台回合结束什么都不发(排错期的 Q13/Q14 是用户按预期答的,非亲见;审计给出确定性机制,以此为准)。真凶是**数组别名**:
  1. `SessionQueues.take()` 无泊位分支返回 `{ ...EMPTY }`——浅展开,`items` 引用模块级共享数组(`session-queues.ts:9,47,51`);
  2. `loadQueue` 原样赋给活队列(`panel.ts:781`)→ 活队列别名 `EMPTY.items`;
  3. A 首次进入(createSession/首访 switch)即别名;排队消息 `push` 进 `EMPTY.items` 本体(`panel.ts:597`);
  4. 切到无泊位的 B:`take(B)` 又是空分支 → B 的活队列拿到**同一数组**(还躺着 A 的消息);
  5. 早快照(`:574`)把它画进 B 的条;`fullResync` 后 `drainRestoredQueue()`(`:576`,`:786-805`)见 B 空闲 → `drainQueue` → `sendNow` → **`prompt(this.sessionId=B, msg)`**。
  6. 且消息是**复制不是搬家**:`stash(A)` 泊的是克隆,错误发送只 shift 别名数组;切回 A 会**再发一次**,两条 transcript 都有。
- 三个被标记的点:🚩 EMPTY 别名(根因);🚩 全部发送路径只靠位置所有权(`this.queue` 属于 `this.sessionId`,`prompt(this.sessionId)` 无从校验归属,`panel.ts:658`);🚩 切换 `await` 窗口竞态(`:551/:558/:559` 与 `:566` 之间,`sessionId` 已是 B 而活队列还是 A 的——分支 4 Q10 缓决的串行化问题)。
- 决策:
  - **Q17**:队列属于会话,送达跟随会话——A 的回合结束时宿主把 A 的队列发给 **A**,不管用户此刻在哪个会话、B 是否在跑。取代 `session-queues.ts:22-28` 的 park-and-return-on-return 设计注释。
  - **Q19**:方案二**键控化**——队列状态(items/paused/pendingForce)只活在 `SessionQueues` 按会话键存;`this.queue` 退化为当前会话的读视图;全部发送点带**显式所属会话参数**;后台/前台排水统一为按会话参数化的同一条路径;`stash/load/drainRestoredQueue` 泊位机制删除。EMPTY 别名类 bug 与 await 窗口竞态结构性消失(盖章 B 的动作按键解析到 B 的空队列,A 的状态碰不到),无需全局串行化。
  - **Q20**:单一 issue 05,分阶段 TDD;顺手硬化广播消息 `sessionID` 必填、会话删除清队列状态。

## 验证

- `npm run typecheck` 随改随跑；单测文件随分支跑（TDD：先失败用例后实现）；`npm test` 全量收尾。
- 人工验证：Bug 1/3 的跨会话复现序列、Bug 2 的切回按钮状态。

## Comments

### 2026-11-18（code-review 落地）

- Standards 轴硬伤：GLOSSARY 的 "Diff list" 词条仍写"this turn / Keep / Revert"，与提交后的行为（会话级 + 仅 Revert）不符——词条已重写，并新增 "Attribution set" 词条与代码词汇对齐（`touchedFiles` → `attributionSet`，过滤变量 `wanted` → `attribution`）。
- Review-stage 重构（均小、机械）：三处重复的驻留丢弃形状抽为 `discardSnapshot()`；三处 poll 过期守卫抽为 `pollStale()` / `pollSessionCurrent()`；`{from?, to?}` 具型为 `DiffRange`（session-diff 导出，client 与测试共用）；`turnMessages` 的 1_500 TTL 具名为 `TURN_CACHE_TTL_MS`。`stampSession` 的十臂 switch 保留不抽——类型安全要求逐 kind 窄化，Set + 展开会失去穷尽检查（judgement call，记录在案）。
- Spec 轴缺口：补"deleted + stale patch 拒绝重建"用例（issue 02 验收点名）；spec 分支 4 的 busy 表述与 removeQueued 纳入同步修正（见上）。
- 两轴复核后全量验证：typecheck / lint OK，316 通过 0 失败 1 跳过。

### 2026-11-18(二轮 grilling:分支 5 立项)

- 用户在新构建上复现队列跨会话发送(分支 5);排错期两次审计(subagent 腿干净;队列腿定根因为 EMPTY 别名)。统一原则与三条腿结论见上方新增小节。工票:issues/05。diff 列表腿另立 `.scratch/diff-list-memory/`;服务器归因调查另立 `.scratch/server-snapshot-attribution/`。ADR-0012 记 Diff list 信任边界。

### 2026-11-19 code-review 修复轮(ticket/fix-review,已接受的取舍记录)

code-review 四条发现:sendNow 缺显示态守卫(ssl-05 issues/05 追记)、fileOnDisk 吞一切报错(dl-03 issues/03 追记)、webview reducer 会话守卫重复、panel.ts 会话删除清理重复——前三类已修,TDD 先红后绿(机械去重除外),358/357/0/1。**以下为明确不做的评审建议,记录在案**:

- **无会话 post 的 `?? ""` 广播标签**:不做。守卫行为已安全——webview 严格比对,空串永不匹配任何真实会话 ID,外章一律丢弃;为此重敲协议类型是无收益的 churn。
- **sendNow/startQueued 的 Data Clump**:不做。本轮刚以 `(text, attachments, sessionID)` 三参稳定下来,再裹对象属于评审期美学,不是缺陷。
- **单用途 `queue` getter**:不做。当前会话队列读视图就一个读者位,抽 getter 只是把一行代码搬个地方。
- **ChatController 多关注点 watch item**:不做(立项级建议)。拆分 ChatController 是独立大工程,不在修复轮动手;如需推进另立工票。

本轮审计中两个边界判定(与上述守卫同族,记录依据):

- **选区 auto-attach 与 `recordModelUsed` 随显示闸门收拢**:二者读/写的都是显示会话的用户上下文(此刻的编辑器选区、picker 的模型选择),后台回合(A 的队列、B 在显示)不应把它们记到 A 头上,故归入 `displayed = sessionID === this.sessionId` 闸门内。
- **`postQueue`/`setPaused` 广播保持无条件**:带所属会话标签的队列簿记,外来 webview 守卫丢弃;是队列/回合机制的一部分,不是显示态。
