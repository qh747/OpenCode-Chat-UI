# 02 删 sendNow 的 dismissed.clear:新回合不复活

Status: resolved
Type: task

实施顺序:在 01 合入后做(同文件相邻区域,避免冲突)。按 spec 决策 Q9 实施(TDD:先红后绿)。

## 验收

- 撤销过的行,**新回合开始不复活**(删 `panel.ts:635` 的 `this.dismissed.clear()`)。
- 「agent 再次改动同一文件 → 签名变化 → 重现」语义不回归(签名机制自足,这是 Q6 决策的唯一重现通道)。

## 代码指位

- `panel.ts:635`(`sendNow` 内);签名机制 `diffKey`(`:2191-2194`)与 `visibleDiffs`(`:1831-1834`)。

## 测试要求(先红)

- 「revert 后 sendNow(新回合)→ 行保持隐藏」(现行为:复活 → 红)。
- 「签名变化 → 重现」不回归(可复用/补一条:撤销后 mock 服务器返回同文件不同签名 → 行出现)。

## Comments

- 2026-11-19(agent):resolved。改动按 spec 决策 Q9 落地,先红后绿。
  - **代码**:`src/webview/panel.ts` — 仅删除 `sendNow` 内的 `this.dismissed.clear()`(原 :635),原位留两行注释指向 Q6/Q9 语义。未触碰 `switchSession`/`createSession`/`dismiss`/`visibleDiffs`(ticket 01)与 `refreshDiffs`(ticket 03)。
  - **测试**:`test/diff-send-memory.test.ts`(新增,3 条)— `dismissed memory across a new turn › a new turn does not revive dismissed rows`(红→绿驱动本票)、`signature change is the only revival › the agent touching the file again gives it a new signature and the row reappears`(Q6 不回归)、`signature change is the only revival › a refresh with the same signature keeps the dismissed row hidden`(同签名刷新保持隐藏,Q6 的另一半)。走既有 duck-typed controller 模式(sendNow 全 duck-type,refreshDiffs 用 mock 服务器 + 真实方法)。
  - **测试基建**:`test/vscode-stub.ts` 的 `workspace` 增加 `getConfiguration`(恒返回调用方回退值),否则 `sendNow` 在测试构建里无法运行;`test/run.ts` 注册新文件。
  - **计数**:实现前该票 1 红(321 pass / 1 fail);最终全量 `npm test` = **338 tests / 337 pass / 0 fail / 1 skipped**(skip 为既有 Windows 路径用例),`npm run typecheck` 与 `npm run lint` 通过。已合并 `batch/0.4.22-session-bound-state` 尖端(含 dl-01/dl-03),合并后全量复测通过。
