# 04 文档收口:ADR-0016 取代 ADR-0010 + folding spec 推翻记录 + GLOSSARY

Status: resolved
Type: task
Blocked by: 01, 02, 03

## 改动

1. **`docs/adr/0016-history-row-status-is-the-roots-own.md`**（新）：记录三级决策链（2026-11-17 诊断 → ADR-0010 聚合 → 本反转），Supersedes: ADR-0010；核心论据——子会话从菜单消失后聚合对象不存在；「绿行指向看不见的东西」比安静更怪；活动信号由 strip 承担。
2. **`docs/adr/0010-history-row-aggregate-status.md`**：Status 改 `superseded by 0016`（不改正文）。
3. **`.scratch/subagent-session-folding/spec.md`**：状态段补推翻记录——菜单折叠被本特性取代；slice 2 的 30s 机制由 strip 红行继承（`.scratch/history-hide-subagents/`）。
4. **`.scratch/history-status-colors/spec.md`**：Comments 补一行推翻注记（→ ADR-0016）。
5. **`GLOSSARY.md`**：「聚合行状态」词条改写为行状态只由主会话自身决定；`Subagent job` 词条「只显示 running」更新为 running + failed(30s) + blocked。

## 验证

- 文档间引用一致（ADR 编号、spec 路径）。
