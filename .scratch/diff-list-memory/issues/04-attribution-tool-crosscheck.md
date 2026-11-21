# 04 归因 credibility 校验:tools 为空的消息不认领文件

Status: resolved
Type: task

按 spec「增补(2026-11-19)」节实施(TDD:先红后绿)。研究依据:`.scratch/server-snapshot-attribution/issues/01-investigate-attribution-boundary.md` 的 `## Answer`(实证:`tools:[]` 的 B 消息认领了外来文件 `a.md`,导致 `deleted a.md +0 -4` 幽灵行穿透严格归因过滤)。

## 验收

- `attributionSet`(`src/util/session-diff.ts:44-55`):**跳过 `tools` 为空**的 assistant 消息的 `snapshot.files`——没调用过任何工具的消息无权认领文件;`tools` 非空的消息照旧全量归因(真写必经 tool,零漏报)。
- 已知二阶局限(写进实现注释):某条 tools 非空的消息窗口恰好框住外来写 → 仍可能串行;观测到再升级为 tool-input 逐文件交叉,本批不做。
- `src/opencode/types.ts:168-173` 的契约注释按研究结论改写:`files` 是该消息快照窗口内共享工作树的内容变化,非「本回合 agent 碰过的文件」;附 `tools:[]` 即外来变化的扩展侧判读。
- `docs/adr/0008-empty-attribution-empty-diff-list.md` 追加「修订(2026-11-19)」节:否决的「按 tool 调用过滤」以最窄形式(per-message credibility)复活,引用研究工票;核心决策(空归因即空列表)不变。
- `GLOSSARY.md`「Attribution set」词条修订:补「只认领调用过工具的消息所声称的文件;tools 为空的消息窗口内的共享树变化视为外来」。

## 代码指位

- `src/util/session-diff.ts:44-55`(`attributionSet`;`AssistantMessage` 的 `tools` 字段形态见 `src/opencode/types.ts`——以消息里实际字段为准,研究者实录中为 `tools:[]`)。
- 既有归因用例:`test/diff-refresh.test.ts`(「an empty attribution set shows an empty list」等——保持绿;注意 tools:[] 消息现在贡献空归因,与严格语义一致)。

## 测试要求(先红)

- 「a message with no tool calls cannot attribute its snapshot files」(红:现行全收 → 外来行通过过滤)。
- 「a message with tool calls still attributes its files」(防误伤:真写不丢)。
- 端到端贴研究者复现:「a foreign deleted row attributed via a tool-less message is dropped」(外来 deleted 行 + 归因来自 tools:[] 消息 → 列表空)。

## 并行约束

与 `session-switch-leaks` issue 05 并行实施:勿触碰队列路径(`session-queues.ts`、panel 的 sendNow/switchSession/turn-end 块);本票范围 = `session-diff.ts` + `types.ts` 注释 + 两份文档 + 测试。

## Comments

- 2026-11-21(agent):升级条件触发,per-file tool-input cross-check 已实施(ADR-0008 第三修订节「Revision (2026-11-21)」)。用户在实践中多次观察到二阶泄漏(附截图:B 会话改动列表串入 A 会话写的文件:03-rename-opencode-sidebar.md、spec.md、CHANGELOG.md、package-lock.json、package.json;全部为 modified 且盘上存在——added 磁盘兜底无效)。
  - **规则**:`attributionSet` 每条 tool-using 消息贡献 = `snapshot.files ∩ 该消息写类工具输入路径集`(write/edit 的 `input.path`;顶层 `tools[].input` ∪ content tool parts `state.input` 双通道并集);无法廉价提取路径的调用(shell/patch/execute/未知名)→ 该消息全量豁免;tools 缺失 → unknown 全量保留;tools:[] → 丢弃(前修订语义不变);旧名归一(bash→shell/apply_patch→patch/task→subagent);绝对路径在 workspace 内先相对化再比对(`attributionSet` 新增可选 workspacePath 参数,panel 调用点传 `this.folder?.uri.fsPath`)。
  - **测试**(TDD 先红后绿,`test/session-diff.test.ts` 归因组 13 用例):改写防误伤用例为交集语义「keeps only the files its write tools touched」;新增 read-only 消息丢弃、shell/patch 豁免、旧名归一、双通道并集、tools:[]+content parts 分类、tools 缺失+parts 在场仍按 parts 分类(Q5 定案:两通道都拿不到才回退 unknown)、workspace 相对化(含盘符大小写不敏感)、tools 缺失保留(锁定)。既有「a foreign deleted row attributed via a tool-less message is dropped」端到端与 tools:[] fixture 全保持绿。最终全量 484 pass / 0 fail,`npx tsc --noEmit` 干净。
  - **已知假阴性方向(有意为之)**:shell 重定向不可见 → 宁可漏显示一条真实行,不串一条外来行;subagent 父会话 raw range 泄露仍由不拉 diffs 挡(工票原结论 3 不变)。
  - **字段偏差(实证优先)**:工票假设的 `tools` 字段**成立**——研究者实录里它就是 assistant 消息**顶层**的 `"tools":[]`(非 `content` tool part);但扩展的 `AssistantMessage` 此前**未建模**该字段,故在 `types.ts` 新增 `tools?: AssistantToolCall[]`(shape 按 v2.3.0 消息原文:`{name,status,input}`),契约注释按研究结论改写(`files` = 该消息自身 `[start,end]` 窗口内共享工作树内容差,`tools:[]` 即外来变化)。这是对「只改注释」范围的最小超出,为实现所必需。
  - **代码**:`src/util/session-diff.ts` `attributionSet` — `tools` 存在且为空数组 → 跳过该消息的 `snapshot.files`(per-message credibility);二阶局限(tools 非空消息窗口框住外来写)写入 JSDoc,注明观测到再升级 tool-input 逐文件交叉。**缺失 ≠ 空**:老 server 不发 `tools` 时保持旧行为(零漏报);v2.3.0 实测每条 assistant 消息都带 `tools`。
  - **测试**(3 条,均按工票命名):`test/session-diff.test.ts` — `a message with no tool calls cannot attribute its snapshot files`(红)、`a message with tool calls still attributes its files`(防误伤,write 工具消息全量归因);`test/diff-refresh.test.ts` — `a foreign deleted row attributed via a tool-less message is dropped`(端到端贴研究者复现 exp3:`tools:[]` 消息 + `deleted a.md +0 -4` → 列表空,deleted 行不触发盘上检查)。既有归因用例未改 fixture 全保持绿(缺失 `tools` 按旧语义)。
  - **文档**:`docs/adr/0008-empty-attribution-empty-diff-list.md` 追加「Revision (2026-11-19): per-message credibility」(引用研究工票,核心决策不变);`GLOSSARY.md`「Attribution set」词条补 credibility 规则。
  - **计数**:红阶段 340 tests / 337 pass / **2 fail**(仅本票新用例,理由正确:现行全收);最终全量 `npm test` = **341 tests / 340 pass / 0 fail / 1 skipped**(既有 Windows 路径 skip),`npm run typecheck` / `npm run lint` 过。已合并 `batch/0.4.22-session-bound-state`(尖端 84f45ad,本票由其切出,合并为 no-op)后复测通过。
- 2026-11-22(agent):升级条件再次触发——per-file cross-check 后用户仍复现(豁免通道是最后入口)。**归属反转**落地,豁免通道全部关闭:
  - **根因链定案**(两通道,逐行核实):①B 的探查回合调过一次 shell(聊天回合常态)→ per-file 交叉校验对无法廉价提取路径的调用全量豁免该消息窗口 → A 的写盘落进窗口即全数放行,added 磁盘兜底无效(用户实录全部 modified 且盘上存在);②`refreshDiffs` 在 per-`added`-行 `fileOnDisk` await 之后、`this.diffs = rows` 赋值之前无 pollStale 复查(`switchSession` 不递增 `diffRequest`,令牌不响),切换落进该窗口时 A 的迟到 poll 污染 host 状态,经 postSnapshot 以 B 的合法身份扇出——该窗口此前有完全的测试盲区(既有 fixture 全 modified、duck-typed controller 无 `fileOnDisk` 方法)。
  - **决策(Q1/Q2,用户拍板)**:归属反转——`attributionSet` 只认本会话 write/edit 的 `input.path` 并集(双通道收集保留,`writePathKey` 归一保留),`snapshot.files` 整体退出归属;豁免机器(KNOWN_TOOLS/LEGACY_NAMES/UNVERIFIABLE_TOOLS/MessageVerdict/keepAll)全删。竞态封堵——赋值前第三次 pollStale 复查;`applySnapshot` 有意不加守卫(快照是整体翻页声明,污染在 host 源头挡)。拍板代价:shell/patch 真实写盘漏显示(假阴性方向翻转),验收不算回归。
  - **测试**(TDD 先红后绿):`test/diff-refresh.test.ts` 新增「files session A generated do not reach B's list when B chats with a shell probe」(用户场景端到端,红→绿)与「an added-row answer that wakes after a session switch is discarded」(竞态窗口,红→绿;探针等 poll 确实挂起在磁盘校验后才切换——第一版测试意外绿,定位出切换落在更早防线,修正后拿真红);`test/session-diff.test.ts` 反转 4 处旧豁免契约并新增零豁免锚「a write call without a path contributes nothing」;三个既有文件(`diff-disk-truth`/`diff-send-memory`/`diff-refresh`)的 `turn()` fixture 补 write 调用,disk-truth/signature/poll 主题断言一字未动;`controllerWith` 补 `fileOnDisk` 修掉 duck-type 盲区。最终全量 **489 pass / 0 fail**,`npm run typecheck` / `npm run lint` 过。
  - **评审**(code-review 两轴子代理):Standards 无硬违规;修复 3 处「第四次修订」计数错误(ADR-0008 实为第三次修订,统一改引日期 2026-11-22)与 3 处陈旧注释(废弃的 per-file cross-check 描述、已删常量 UNVERIFIABLE_TOOLS 悬空引用)。Spec 实现本体无错误;回归锚由既有「the whole session is requested」用例兼任(注释已标注 spec 改动 3-③)。
  - **文档**:`docs/adr/0008` 追加「Revision (2026-11-22): ownership inversion — write/edit paths only」;`GLOSSARY.md`「Attribution set」词条重写;`panel.ts`/`session-diff.ts` JSDoc 同步;spec.md 增补(2026-11-22)节,Open 节二阶条目勾销。
