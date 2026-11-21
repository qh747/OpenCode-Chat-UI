# 工票 02：Server config panel 增加「派生深度」（experimental.subagent_depth）

Status: ready-for-agent

## 需求

子代理禁止再派生子代理的显式控制（预防性需求，Q5=b；官方默认 `subagent_depth=1` 已禁止）。用户选定插件姿态：Server config panel 加一行（Q6=b），贴合 ADR-0006 的 server-config-file-backed 架构，不做注入、不代管。

## 改动面

1. `src/util/settings-items.ts` `SERVER_SETTINGS` 追加：
   - `id: "subagent_depth"`、`control: "number"`、`configPath: ["experimental", "subagent_depth"]`、`defaultValue: 1`、`defaultText: "1"`、`labelKey: "settings.subagent_depth.label"`、`hintKey: "settings.subagent_depth.hint"`。
2. `src/util/i18n.ts`：en + zh-cn 各加 `settings.subagent_depth.label` / `.hint`。hint 说明：1（缺省）= 子代理不能再派生子代理；调大即允许嵌套；该键属实验性，官方后续版本可能改名。
3. 风险已接受：键在 `experimental.*` 下，官方可能变动；写错/被无视均无害（失败软着陆）。

## 测试缝（预约定）

- `test/settings-items.test.ts`：`SERVER_SETTINGS.length` 10 → 11；`findSettingsItem("subagent_depth")` 的 configPath/defaultValue/control 断言；label 双语在案（既有循环已覆盖）。

## Comments

- 2026-11-21 实施完成（305e9a6）。双轴评审：无缺陷。走 SERVER_SETTINGS 既有通道贴合 ADR-0006，不新开 ADR。
