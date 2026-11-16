# 06 AI 提问后 SubagentStrip 消失

Status: resolved
Type: task

按 spec 分支 6 实施。验收：回合结束先最终刷新 subagents，有 running job 保留轮询至全部结束；`execution.started`/`step.started` 补 `startSubagentPolling()`；snapshot 语义不动；DEBUG 探针暂留。

## Comments

### 2026-11-17（code-review 修复补充）

- Spec 轴审查指出轮询收尾窗口：主回合执行中（busy）轮询到空列表会提前停表，本回合内稍后才 spawn 的 task job 只能靠后续 step 事件兜底。已修：自动收尾条件补 `!this.busy`——主回合执行期间不因空列表停表，等待子代理/全空收尾语义不变。
- Standards 轴审查指出 `clearSubagents` 注释与分支 6 新行为矛盾（"回合结束即丢弃"），已改写为准确描述（job 跨回合存活，仅新会话/切换/确认无运行中 job 时调用）。
### 2026-11-17

- 回合结束分支：`clearSubagents()` → `settleSubagents()`（最终 `refreshSubagents()` 一次；仍有 running job 则保留轮询让 strip 跟到全部结束；全空才 `clearSubagents()`）。
- `refreshSubagents()` 末尾新增收尾：轮询中发现 jobs 为空 → 自动 `clearSubagents()` 停轮询（guarded by `this.subagentTimer`，不影响其他调用点）。
- `session.step.started`/`session.execution.started` 分支补 `startSubagentPolling()`（幂等），服务器拉起的 steer/continuation 回合也能恢复轮询。
- snapshot 覆盖语义与 DEBUG 探针保持不动（按决策）。
- 同步更新 `refreshSubagents` 上方的过时注释。
- typecheck / lint / 233 测试全绿。

