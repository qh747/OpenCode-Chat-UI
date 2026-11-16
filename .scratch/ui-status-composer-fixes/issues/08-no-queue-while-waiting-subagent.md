# 08 等待子代理时不排队

Status: resolved
Type: task

按 spec 分支 8 实施（范围 A）。验收：排队仅发生在主回合执行中窗口；等待子代理态下新消息直接 `sendNow`（服务器 steer/新回合）；本地队列与 QueueStrip 保留。

## Comments

### 2026-11-17

- 核对结论：排队窗口与决策一致，无需行为改动。`send()` 的 `if (this.busy)` 分支即"主回合执行中"窗口（busy=true 由 sendNow/execution.started 建立、回合结束事件清除）。
- "等待子代理"窗口 busy=false（issue 04 修复后结构性保证）→ 新消息直接 `sendNow` → 服务器接受为 steer 或开启新回合（已核实 v2.3.0 服务器不检查 busy）。
- 用户观察到的"等待时排队"根因即 issue 04 的 busy 单向置位残留；本地队列与 QueueStrip 机制原样保留（主回合执行中时的行为不变）。
- `send()` busy 分支补注释固化该语义边界。

