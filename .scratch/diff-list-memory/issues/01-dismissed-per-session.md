# 01 dismissed 按会话 park:切换不再失忆

Status: ready-for-agent
Type: task

按 spec 决策 Q10 实施(TDD:先红后绿)。

## 验收

- 撤销 A 中文件 → 切 B → 切回 A:该行**不复活**(签名隐藏跨切换存活)。
- `dismissed` 从 panel 全局 Map 改为按会话 park(与 `sessionQueues` 同款模式):`switchSession` 泊出旧会话、载入目标会话(无泊位则空表),替代 `panel.ts:565` 的 `clear()`。
- `createSession:517` 的 clear 改为同款「泊出旧、载入新空」。
- `rewindTo:1048` 的 clear **保留**(决策:倒带后重新开始)。
- `deleteSessionById`(`panel.ts:1114-1123`)及 `session.deleted` 事件路径(`:1406-1421`)顺带清该会话 parked 记忆(现状只清 diffs/turnCache,会漏积)。
- 键统一:`dismiss`/`visibleDiffs` 现用原始路径字符串,`refreshDiffs` 过滤用 `diffFileKey` 归一化——统一走 `diffFileKey`。

## 代码指位

- 字段声明 `panel.ts:89-94`;清除点 `:517` / `:565` / `:1048` / `:1114-1123` / `:1406-1421`;`dismiss` `:1826-1829`;`visibleDiffs` `:1831-1834`;`diffKey` `:2191-2194`;`switchSession` `:549-578`;`createSession` `:507-` 附近。
- 测试现状:`test/` 无任何 dismiss/visibleDiffs/diffKey 断言(仅 fixture 字段);`test/session-switch.test.ts` 钉早快照与队列泊位。

## 测试要求(先红)

- 「revert 后切走再切回 → 行保持隐藏」(现行为:复活 → 红)。
- 「会话删除 → 该会话 parked 记忆清除」。
- 既有「签名变化 → 重现」语义不回归。

## Comments
