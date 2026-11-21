# 工票 01：子代理视图减法（三条列表结构性不渲染 + host 停拉数据）

Status: ready-for-agent

## 需求

子代理视图（查看 `parentID ≠ null` 的会话）不显示：文件改动列表（DiffList）、消息排队列表（QueueStrip）、子代理列表（SubagentStrip）。用户在 0.4.22 上从未见过后两者——本票是结构性保证，不是修 bug。动机（Q1）：a 看子代理时没用 + b 省空间 + c 归因集小、列表闪现语义不对 → **连数据也不拉**。

## 改动面

1. `webview-ui/app.tsx`：DiffList（L436）与 SubagentStrip（L445）渲染加 `!state.isSubagentSession`；QueueStrip（L452）现有门保留。主会话视图三块不变（Q2）。
2. `src/webview/panel.ts`：
   - `refreshDiffs`：`isSubagentSession` 早退，先 `++diffRequest` 作废在途同会话轮询；
   - `refreshSubagents`：同上（`++subagentRequest` 后早退，不碰 `this.subagents`、不 post）；
   - `startSubagentPolling`：`isSubagentSession` 时不起表。
   - 不需要 stop-on-meta 钩子：switchSession 的 `clearSubagents` 已停表，fullResync 在 `await Promise.all`（meta 在内）之后才 `startSubagentPolling`，届时 flag 已落地。
3. GLOSSARY.md：新增 **Subagent view** 词条。
4. 子代理视图终态（Q4）：头部（返回按钮 + 标题 + 图标组）+ 消息流；不加新东西。

## 测试缝（预约定）

- host：`refreshDiffs` 对子代理会话不调 diff 端点、不广播（`diff-refresh.test.ts` 鸭子型支架加 `isSubagentSession`）。
- host：`refreshSubagents` 对子代理会话不调 jobs、不 post、不动 `this.subagents`（`subagent-refresh.test.ts` 同法）。
- host：`startSubagentPolling` 对子代理会话不起表（同文件）。
- webview：App 级真实 DOM 断言——子代理视图下 `.diff-head` / `.subagent-strip` / `.queue-head` 均不出现（有数据也不出现）；根会话视图下照常出现（新 `test/subagent-view.test.tsx`，沿 subagent-nav 的 jsdom + createRoot + act 支架）。

## Comments
