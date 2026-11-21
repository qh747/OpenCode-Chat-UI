# 工票 03：更名 OpenCode Side Panel → OpenCode Sidebar

Status: ready-for-agent

## 需求

发布名 "opencode side panel" 不好记、不易搜到（Q8 用户先后否掉 Dock/Sidecar/Companion/Deck 一类配件品牌词，Q9 定性「不像官方」）。终选 **OpenCode Sidebar**（Q10）：朴素 UI 名词、首词 OpenCode 承担官方语感、MS Marketplace 素形无主（2026-11-21 浏览器实测；周围 6 个 "OpenCode Sidebar ×" 变体反而是掩护）。

## 范围（Q7=a：只改显示名，市场 ID 不动）

市场 ID `quhan.opencode-panel` 不变（保安装/评分/更新链）；GitHub 仓库名不动（用户确认）。落点 5 处：

1. `package.json` L3 `displayName`
2. `README.md` L1
3. `README.zh-CN.md` L1
4. `LICENSE` L3（"OpenCode Side Panel contributors" → "OpenCode Sidebar contributors"）
5. `GLOSSARY.md` L3（"Canonical terms for the OpenCode Side Panel extension"）

VSIX 文件名沿用 `pkg.name`（opencode-panel），不变。README 既有 "Community integration, not an official opencode product." 声明保留。

## 测试缝

无（纯文案）。验证：全仓 grep `Side Panel` 仅剩 `.scratch/` 历史记录中的泛指用法。

## 边界（记录，不处理）

- `repository.url` 指向 `qh747/opencode-vscode-plugin.git`，与用户所述仓库名不符；用户未要求修正，保持原样。

## Comments

- 2026-11-21 实施完成（bca895e）。双轴评审：无缺陷；全仓 grep `Side Panel` 仅剩 .scratch 历史记录。
- 2026-11-21 增补（ff226d6 之后的产物名补充）：用户要求打包文件名也随新名——`release.mjs` 产物名改由 displayName 派生（`opencode-sidebar-<version>.vsix`），README 双语安装路径同步。**扩展 ID 仍是 `quhan.opencode-panel`**（`pkg.name` 是市场身份，动了等于分叉新条目）；文件名只是给人看的。0.4.23 已按新名重打并验包（displayName=OpenCode Sidebar）。
- 2026-11-21 再增补（用户推翻 ID 保留）：**`package.json` name → `opencode-sidebar`**，市场 ID 变为 `quhan.opencode-sidebar`。用户确认当前没有旧用户，旧条目 `quhan.opencode-panel`（≤0.4.19，4 安装）由用户在发布者后台下架。新条目以 0.4.23 起步；`package-lock.json` 同步；storageKey（`opencode.activeSession:<path>`）与扩展名无关，不受影响。
- 2026-11-21 最终定稿（名称冲突）：`quhan.opencode-sidebar` 无法创建，Marketplace 返回 “The extension 'opencode-sidebar' already exists in the Marketplace”。管理页查无条目、公开 Gallery 也查无该 ID——名称全局唯一，且被移除的条目名称会永久保留（官方文档明确不可复用，原发布者也不行）。故 `package.json` name → **`opencode-plugin`**，扩展 ID 变为 `quhan.opencode-plugin`；displayName 仍为 **OpenCode Sidebar**，VSIX 产物名（按 displayName 派生）不变。
- 2026-11-22 再修订（displayName 也撞名，0.4.24 首次 publish 实证）：以 displayName "OpenCode Sidebar" 上传 0.4.24 被拒——“This extension display name is taken”。**2026-11-21 浏览器实测的“素形无主、变体是掩护”判断是反的**：变体群（`Opencode Sidebar Chat`、`OpenCode Sidebar Web`、`OpenCode Sidebar GUI` 等）才是根，素形是它们的规范化前缀，publish 时被判占用。市场 display name 唯一性规则（本轮 gallery API 预筛 + publish 实证反推）：新名与现有 displayName 规范化后精确相等、或**是某个现有 displayName 的前缀（更短）→ 拒**；新名以现有名开头（更长）→ 不拒（大量 `OpenCode Xxx` 第三方显示名以官方 `opencode` 为前缀仍发布成功）。displayName → **OpenCode Chat UI**（gallery 预筛双规则通过）；ID `quhan.opencode-plugin` 不动；产物名随新 displayName 变为 `opencode-chat-ui-<version>.vsix`；README/LICENSE/GLOSSARY 同步。教训入 CHANGELOG 0.4.24。
