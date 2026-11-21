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
