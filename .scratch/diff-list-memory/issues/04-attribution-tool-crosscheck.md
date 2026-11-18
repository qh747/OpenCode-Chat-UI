# 04 归因 credibility 校验:tools 为空的消息不认领文件

Status: ready-for-agent
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
