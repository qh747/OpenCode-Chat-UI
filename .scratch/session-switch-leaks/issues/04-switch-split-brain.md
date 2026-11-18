# 04 切换精神分裂窗口三件套：早快照 / 会话戳 / take 删除克隆

Status: resolved
Type: task

按 spec 分支 4 实施（TDD：先补失败用例）。验收：
1. `switchSession` 在同步清理完（loadQueue / clearForms / clearSubagents 之后）先 `postSnapshot()` 再 `fullResync`——早快照带新 sessionID，busy 尽力取 activeSessions map；fullResync 后仍有完整快照。
2. 动作类消息（send / 队列 force+resume / abort / formReply / formCancel / 权限应答 / stopSubagent / revertFile）带 webview 当前 `state.sessionID`，宿主统一守卫不匹配即丢弃；`switchSession` 本身不盖。
3. `SessionQueues.take()` 取出即删除 + 浅克隆，消除驻留数组别名。
明确不做：handleMessage 全局串行化（Q10）。

## Comments

### 2026-11-18

- 会话戳（4b）与 revertFile 校验同片落地（见 issue 02 Comments）：protocol 加字段 + `stampSession`/`isStaleAction`，宿主 `handleMessage` 入口统一守卫，webview `main.tsx` 出口集中盖章。
- 4c TDD：`test/session-queues.test.ts` 三条新用例（take 即删、take 克隆、stash 克隆防原地 push 泄漏）；`session-queues.ts` 抽 `cloneSnapshot`（无 pendingForce 时省略该键，保持既有 deepEqual 形状），stash/take 双向克隆，take 取出即删除。
- 4a TDD：`test/session-switch.test.ts`（新，注册进 run.ts）两条用例：resync 未落地时早快照已带新 sessionID + 新会话空队列（A 的 msg1 不得出现）；离开前旧队列正确 stash。harness 用真原型方法（stashQueue/loadQueue/storageKey）驱动真 `switchSession`，`fullResync` stub 保持"收口 postSnapshot"契约。
- `switchSession` 在 clearSubagents 之后、`fullResync` 之前插入 `this.postSnapshot()`。busy 字段说明：`activeSessions()` 是异步端点，早快照必须同步发出，故带复位标志（false），由 fullResync 里的 `refreshSessionMeta`（busy > idle 谓词，issue 03）在一个往返内纠正——决策 4a"尽力取值"落地为复位标志 + 快速纠正。
- 单测 308 通过 0 失败，typecheck 通过。曾出现 git 用例连带失败，定位为本测试早期 harness 缺原型方法产生的未处理 rejection 毒化进程，harness 修正后消失。

### 2026-11-18（code-review 确认）

- Spec 轴确认 4a 的 busy 表述偏差（"activeSessions map 尽力取值" → 复位标志 + 快速纠正）与 removeQueued 纳入盖章集，二者均已在 spec.md 修正为实施口径，与 ADR-0009 的取舍一致。
- review-stage 重构（discardSnapshot / pollStale / DiffRange / TURN_CACHE_TTL_MS）落在 issue 01/02 与本 spec 的 Comments。
