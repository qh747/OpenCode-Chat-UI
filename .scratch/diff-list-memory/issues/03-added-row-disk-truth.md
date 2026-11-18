# 03 added 行磁盘真相兜底:盘上无文件的 added 行不显示

Status: resolved
Type: task

实施顺序:与 01 可并行(区域不相交:01 在 switchSession/createSession/deleteSession/dismiss,03 在 refreshDiffs)。按 spec 决策 Q8 实施(TDD:先红后绿)。

## 验收

- `refreshDiffs` 过滤链中(归因过滤之后),`status=added` 且**盘上无此文件**的行 → 不进入 `this.diffs`。
- `deleted` 状态的行**不受影响**(文件不在盘上是其「待处理」常态,恢复它才是待办;加测试钉住:deleted 行 + 盘上无文件 → 仍显示)。
- `modified` 不做检查(无法廉价校验内容)。
- 检查用 `resolveFileUri` 后的盘上路径做存在性判断(与 `revertFile` 同一解析路径,避免 URI 形态分歧)。

## 代码指位

- `panel.ts:1791-1823`(`refreshDiffs`,归因过滤在 `:1819-1820`);`resolveFileUri` 见 `revertFile` 用法(`:2075`)。
- 此兜底同时压住:B 侧被服务器写宽归因的 added 幽灵行(spec 同族 2)、窗口重载后 added 复活行(内存记忆丢失场景)。

## 测试要求(先红)

- 「added 行 + 盘上无此文件 → 列表为空」(现行为:显示 → 红)。
- 「deleted 行 + 盘上无此文件 → 仍显示」(防误伤;实现若一刀切会红)。
- 归因过滤行为不回归(既有 `test/diff-refresh.test.ts` 用例保持绿)。

## Comments

- 2026-11-18 (ticket/dl-03): 按 spec 决策 Q8 完成,TDD 先红后绿。
  - 变更文件:
    - `src/webview/panel.ts` — `refreshDiffs` 过滤链改为单遍循环:归因过滤之后,`status === "added"` 且 `!fileOnDisk(file)` 的行被丢弃(`deleted`/`modified` 不查);新增私有助手 `fileOnDisk`,用 `vscode.workspace.fs.stat` + `resolveFileUri` 同一解析路径做存在性判断。
    - `test/vscode-stub.ts` — 内存 `workspace.fs` 增加 `stat`(在 `memoryFiles` 即存在,否则抛 ENOENT,沿用既有 fixture 模式)。
    - `test/diff-disk-truth.test.ts`(新增)+ `test/run.ts` 注册。
  - 新增测试(`added rows disk truth` 套件):
    - `an added row whose file is not on disk does not show`(红→绿:实现前幽灵 added 行显示)
    - `an added row whose file is on disk still shows`
    - `a deleted row whose file is not on disk still shows`(防误伤钉子)
    - `the disk truth check runs after the attribution filter`
  - 计数:`npm test` 322 tests / 321 pass / 0 fail / 1 skipped(基线 318/317/0/1);`npm run typecheck`、`npm run lint` 通过。
  - 未触碰 dismissed map 与 switchSession 队列代码(01/02 票区域)。
