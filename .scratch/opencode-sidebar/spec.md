# Spec: 子代理视图减法 + 派生深度配置 + 更名 OpenCode Sidebar（opencode-sidebar）

日期：2026-11-21。来源：grilling 会话（`/grill-with-docs`，决策全部经用户逐条确认）。发布形态：三个工票一次落地，产品更名 **OpenCode Sidebar**（原 OpenCode Side Panel）。

## 需求（用户原始三条）

1. 子代理的界面不显示文件改动列表、消息排队列表、子代理列表。
2. 子代理有办法控制禁止再次派生子代理吗？
3. 插件发布名 "opencode side panel" 不好记、不易搜到，换一个不与既有扩展冲突、好记的名字。

## 事实（代码审计基线，2026-11-21，HEAD 644102e）

- 子代理视图现状（`isSubagentSession` = `session.parentID !== undefined`，`panel.ts` refreshSessionMeta）：
  - **QueueStrip 已隐藏**：`app.tsx` L452 `{!state.isSubagentSession && …}`，早于 0.4.22 发布（a74d820 起）。
  - **Composer 已隐藏但保挂载**（issue 12，保草稿）；头部**返回按钮已存在**（subagent-nav spec Q7）。
  - **DiffList 仍显示**：只挂 `hasMessages`（`app.tsx` L436），数据走 `refreshDiffs` → 归因集过滤（ADR-0008）。
  - **SubagentStrip 无条件挂载**（`app.tsx` L445）；数据 `refreshSubagents` 轮询 `client.jobs(viewedSession)`——按 `client.ts` 语义为「该会话及其后代」的 jobs；官方默认 `subagent_depth=1` 时子代理必无后代，条恒空。用户确认 0.4.22 上未见过排队条/子代理条，本工票是**结构性保证**（不能出现），不是修 bug。
- **嵌套派生**（官方文档 2026-11 查证）：opencode V2 默认 `experimental.subagent_depth = 1`，子代理不能再派生；另有按 agent 的 `{action:"subagent", effect:"deny"}` 权限规则；内置 `general` 子代理本来就禁止。用户全局配置未放宽过 depth；用户确认属**预防性需求**（未观察到真实嵌套）。
- 插件无任何禁嵌套代码；spawn server 不传 config 标志；插件写服务器配置的既定通道是 Server config panel（`SERVER_SETTINGS` → `updateConfigText`，ADR-0005/0006）。
- 改名基线：`quhan.opencode-panel`（MS Marketplace 已上架，4 安装；Open VSX 无此扩展）。**displayName 市场不强制唯一**——痛点是搜索辨析。MS Marketplace 占用地图（2026-11-21 浏览器实测）：Panel / Dock / UI / Console / Chat / CLI / GUI / Studio / for VSCode 等朴素词全被占；**素形 "OpenCode Sidebar" 无主**（周围 6 个 "OpenCode Sidebar ×" 变体反而是掩护——素形在变体群里最像官方）。"OpenCode Desktop" 空着但官方真有 desktop 应用，弃。

## 决策（grilling Q1–Q10，全部用户确认）

- **Q1 隐藏 DiffList 动机 = a+b+c**（看子代理时没用 + 省空间 + 归因集小频繁闪现语义不对劲）→ **连数据也不拉**，不只是不渲染。
- **Q2 三条列表 = 结构性保证**：子代理视图里三者一律不渲染（QueueStrip 保留现有门；DiffList/SubagentStrip 新增门）；主会话视图三块不变。
- **Q3 撤回**：子代理视图没有 composer（无法给子代理排队），「留排队列表」不成立。
- **Q4 子代理视图终态 = 最小形态**：头部（返回按钮 + 标题 + 图标组）+ 消息流；不加任何新东西。
- **Q5 嵌套观察 = 预防性**（未见过真实嵌套）。
- **Q6 插件姿态 = Server config panel 加一行**「Subagent depth / 派生深度」，写 `experimental.subagent_depth`，显示 explicit value + 缺省回落 1。键在 `experimental.*` 下、官方可能变动——写错键无害，失败软着陆。不注入、不代管、不写 README 之外的文档。
- **Q7 改名范围 = 只改显示名**：市场 ID `quhan.opencode-panel` 不动（保安装/更新链）；GitHub 仓库名不动（用户确认仓库名与此无关）。
- **Q9/Q10 定名 = OpenCode Sidebar**（朴素 UI 名词 + 首词 OpenCode 承担官方语感；README 既有 "Community integration, not an official opencode product" 声明压住冒充风险）。

## What was implemented

（master 分支，2026-11-21；基点 644102e。逐票提交，TDD：`test/subagent-view.test.tsx`、`test/subagent-refresh.test.ts`、`test/diff-refresh.test.ts`、`test/session-meta.test.ts`、`test/settings-items.test.ts`。）

- **工票 01（子代理视图减法）**：
  - webview：`app.tsx` DiffList 与 SubagentStrip 渲染加 `!state.isSubagentSession` 门（QueueStrip 门保留）；主会话视图不动。
  - host：`refreshDiffs` / `refreshSubagents` 对子代理会话**早退并作废在途轮询**（`++request` 后 return，连数据都不拉）；`startSubagentPolling` 对子代理会话不起表。`switchSession → clearSubagents → fullResync → await Promise.all(含 refreshSessionMeta) → startSubagentPolling` 的既有顺序保证进入子代理视图时 meta 已落地、门生效——无需 stop-on-meta 钩子。
  - 已知边窗（记录，不处理）：Promise.all 并发窗口内 meta 未落地前，refreshDiffs 可能对刚切入的子代理会话拉一次 diff——一次性、有界、结果无显示面。
  - GLOSSARY：新增 **Subagent view** 词条（显示是视口规则的显示面延伸）。
- **工票 02（派生深度）**：`SERVER_SETTINGS` 新增 `subagent_depth` 行（`control:"number"`、`configPath:["experimental","subagent_depth"]`、`defaultValue:1`），i18n 双语 label/hint。
- **工票 03（更名）**：`package.json` displayName、`README.md` / `README.zh-CN.md` 标题、`LICENSE` 署名行、`GLOSSARY.md` 首行，共 5 处 → "OpenCode Sidebar"。VSIX 文件名沿用 `pkg.name`（opencode-panel）不变。

## 边界（记录，不处理）

- `repository.url` 写的是 `qh747/opencode-vscode-plugin.git`，与用户所述仓库名不符——用户未要求修正，保持原样。
- 用户未来若经工票 02 显式把 depth 写成 2：主会话视图的 strip 会显示孙任务行（`jobs(root)` 含后代）；子代理视图依旧全藏（结构性保证优先于数据可见性）。
- 权限卡在子代理视图仍显示并可回复（transcript 内联，属既有行为，不在本批）。
- `strip-runtime-observations` 的两条活体观察（权限归属、error 留存）与本批无冲突，另行挂账。
