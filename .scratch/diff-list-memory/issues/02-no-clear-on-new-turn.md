# 02 删 sendNow 的 dismissed.clear:新回合不复活

Status: ready-for-agent
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
