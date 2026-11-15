# Diff list visibility

Status: implemented

## Question

面板底部的「已修改文件」列表（Changes / Keep / Revert）每个 turn 结束都会
出现并常驻，直到逐个处理完。能不能不让用户处理就不可见？不行的话，
能不能默认折叠、点击再展开？

## Facts established first

- **Keep 不是"处理"改动。** `keepFile` 只是 `dismissed.add(file)` ——
  改动本来就在盘上，Keep 仅仅让那一行从列表里消失。
- **Revert 是面板独有的能力。** 扩展自己把文件写回（added → 删除进回收站，
  deleted → 重建目录再写回，modified → 写回 before 内容）。
  VS Code 的源代码管理面板能看 diff、能整体丢弃，但"只回滚 agent 改的
  这一个文件"只有这里能做。
- 每个 turn 结束都拉一次**全量** session diff（`GET /api/session/{id}/diff`），
  所以列表是累积的，不会自己消失。
- 既有先例：QueueStrip（`▸ QUEUE n`）在同一位置、同一种交互，
  默认折叠成一行，从不自动展开。

## Verdict

**折叠。** `▸ CHANGES 2 · +31 -4` 一行，点击展开成带 Keep / Revert 的行。
头部带增删统计 —— 它是唯一能让人不展开就判断规模的东西。

原型比较了四个变体（`prototype/diff-visibility/`，`npm run prototype:diffs`）：
现状常驻、完全不显示、折叠、折叠加批量按钮。选了折叠：

- 「不显示」否决 —— Revert 的可达性会丢给 VS Code 的 SCM 面板。
- 「批量按钮」否决 —— 两个按钮常驻在折叠行上，是为一件用户并不总要做的事
  驻留两个入口。
- 「自动展开」否决 —— QueueStrip 从不自动展开，折叠头上的数字本身就是信号；
  次要 UI 默认只花一行。

## 顺带修掉的 bug

`dismissed` 原来是文件名集合，不记得是**哪一轮**改动被 dismiss 的。agent
下一轮再改同一个文件，那一行永远不会重新出现 —— 用户 Keep 了 `TEST.md`，
下一轮 agent 又改它，这次改动对用户不可见。

改成 `Map<file, 被 dismiss 的那轮 diff 签名>`（`status:additions:deletions`），
广播时只过滤签名仍然匹配的。改动变了就回来。

## What was implemented

- `webview-ui/Cards.tsx` — `DiffList` 折叠头 + 展开行；列表空时重置折叠态。
- `src/webview/panel.ts` — `dismissed` 改为签名映射；`dismiss()` /
  `visibleDiffs()`。
- `webview-ui/styles.css` — `.diff-head` / `.diff-toggle` / `.diff-caret` /
  `.diff-count` / `.diff-total`，与 `.queue-head` 同构；
  `.diff-list-title` 移除。
- `test/diff-list.test.ts` — 折叠态（头部计数、无行、无动作按钮）与空态。
- `prototype/diff-visibility/` — 四变体原型，结论记在其 README。

## Open

原型按仓库惯例应提交到 throwaway 分支留存，本次未做（未获提交授权）；
`prototype/diff-visibility/` 目录是当前唯一副本，`rm -rf` 即失。
