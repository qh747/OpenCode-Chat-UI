# Spec: 会话稳定性——新会话翻页残留修复 + 历史列表创建序（session-stability）

日期：2026-11-22。来源：grilling 会话（`/grill-with-docs`，Q1–Q11 全部经用户逐条确认），并由两个后台 subagent 复核（服务器排序字段调研 v2.3.2 源码；新会话链路对抗审计含 v2.3.0 活体实测）。

## Problem Statement（用户视角）

1. 我在当前会话里点"+"新建会话，面板没有跳到新会话——标题换了，但**消息流还是旧会话的内容**，全程无任何错误提示（grilling Q5 修订版确认症状形态=旧消息残留）。
2. 会话历史列表里的会话位置**来回变动**——哪个会话刚有活动哪个就跳到组顶，我要求位置稳定。
3. 附带确认要修的四点（Q9 用户决策：**全部进本批修复**，推翻"仅挂账"建议）：断连/挂起时点"+"无任何反馈；中文界面新会话标题显示服务器英文串；旧会话晚到的权限/表单轮询污染新会话快照；侧栏 sink 泄漏。

## Solution（用户视角）

点"+"永远翻到干净的新会话页面（消息流清空、标题换新）；历史列表按创建时间排布，位置永不因活动变动，行时间列与排序语义自洽；点"+"立即有"创建中"反馈；新会话标题在中文界面显示"新会话"。

## User Stories

1. 作为聊天用户，在旧会话里向上滚动加载过早前消息后点"+"，我要看到消息流立刻清空、翻到干净的新会话，这样新消息不会与旧会话内容混在一条时间线里。
2. 作为聊天用户，点"+"后头部标题立刻变为新会话标题，这样我能确认点击已生效。
3. 作为聊天用户，删除当前会话（历史行删除或外部删除）后，面板不残留已删会话的回填消息，这样随后进入的会话是干净的。
4. 作为聊天用户，切换或新建会话后，新页面永远不出现旧会话的权限卡或表单，这样我不会误答复别的会话的请求。
5. 作为聊天用户，历史列表中每行的位置不随会话活动变动，这样我靠位置记忆就能找到会话。
6. 作为聊天用户，新建的会话出现在历史列表顶部，且位置随后保持不变。
7. 作为聊天用户，历史行的时间列显示创建时间，与列表顺序自洽，这样不用猜排序规则。
8. 作为同时运行多个会话的用户，打开历史菜单时顺序依然稳定，不因哪个会话刚好有活动而跳位。
9. 作为命令面板 QuickPick 的用户，`OpenCode: Session History` 显示与 webview 菜单一致的稳定顺序与创建时间。
10. 作为慢网或服务器僵死场景下的用户，点"+"后立即看到"创建中"内联反馈，这样我知道点击已生效而非面板失灵。
11. 作为中文界面用户，新会话头部显示"新会话"而不是服务器返回的英文 "New session - 时间戳" 串。
12. 作为中文界面用户，历史列表与 QuickPick 对未起名的新会话同样显示"新会话"。
13. 作为扩展用户，侧栏视图反复显示/销毁后不留泄漏的 sink，长期使用不积累失效广播目标。
14. 作为使用外接服务器的用户，断连窗口里点"+"时连接横幅仍在兜底提示（既有设计保持不变），本批修复不破坏该契约。

## Implementation Decisions（grilling D1–D9 定案）

- **两问题独立**（Q2）：翻页残留是 bug，列表稳定是 UX 需求，无因果绑定，同批落地。
- **翻页残留修复**（不变量："离开一个会话必须清它的回填历史"）：根因 `createSession()`（`src/webview/panel.ts:588`）漏调 `resetLoadedHistory()`——旧会话 `earlierMessages` 经 `renderableTranscript()`（`:1790`）合入新会话快照。`switchSession`（`:662`）、`rewindTo`（`:1278`）、revert 变化（`:2314`）三处有调，本批补齐 `createSession`、`deleteSessionById`（`:1349` 附近）、`session.deleted` 事件分支（`:1656`）——落点可选共享拆除点 `dropSessionState`（`:942`），实现者按共享断言决定（Q8）。
- **轮询守卫**（审计附带 1）：`refreshPermissions`/`refreshForms`（`:1985`/`:2014`）无会话守卫，晚到的 A 轮询会把 A 的权限/表单写进宿主态、随下一张快照以 B 的名义扇出。修法=发轮询前捕获当前 sessionId、写回前比对（镜像 `refreshMessages` 的 `pollSessionCurrent` 捕获-比对模式）。
- **列表创建序**（Q4/Q7）：服务器 `GET /api/session` 的 `order` 只按 `time.updated` 排 asc/desc（opencode v2.3.2 `packages/core/src/session/store.ts:156,187`，无自定义排序字段参数）→ **客户端拉取后按 `created` 本地重排**；`groupHistoryRowsByDate`（`src/util/sessions.ts:57`）分桶键换 `created`；webview 历史行时间列显示 `created`（`HistoryMenu.tsx:79`）；QuickPick（`src/views/historyPicker.ts`）排序、分桶、description 三处同改。接受拉取窗口偏差：窗口是"最近活动的 100 个"，极老静默会话可能缺席（Q4 已披露）。
- **点按即反馈**（Q10a）：`createSession` 在首个 await 前发轻量"创建中"状态消息（新协议条目），新会话落地或报错后清除；webview 头部内联显示；30 秒超时值不动（改短治标不治本且误伤慢网）。
- **自动标题本地化**（Q11a）：显示层窄正则识别服务器自动标题 `New session - <ISO 时间戳>`（v2.3.0 活体实测确认格式；`app.tsx:346` 的 `??` 兜底永不触发——服务器返回非空串），命中时头部、历史行、QuickPick 三处统一显示 `t("newSession")`，不命中原样降级；不改服务器数据。
- **sink 泄漏**（审计附带 3）：`src/webview/view.ts:76` 丢弃了 `bridgeWebview` 返回的 Disposable——保留并在 provider 销毁时 detach sink。
- **GLOSSARY**：新增「History order」词条（创建序；位置不随活动移动）。
- **不立 ADR**：created-vs-updated 取舍三条标准中"难以逆转"不满足（行级改动），决策记录进本 spec。

## Testing Decisions

- **好测试只测外部行为**：宿主侧断言 posted 快照序列，webview 侧断言渲染输出/状态 reducer，纯函数断言输入输出；不窥探私有字段（宿主 harness 允许注入初值）。
- **接缝全部复用既有接缝，不新增**（已与用户确认）：

| 工票 | 接缝 | 先例 |
|---|---|---|
| 01 翻页残留+守卫 | 宿主控制器 harness（真 `ChatController.prototype` 方法 + fake client + `posted` 快照记录） | `test/session-switch.test.ts`、`test/earlier-store.test.ts` |
| 02 创建序排序 | 纯函数层（排序+分桶）+ webview 渲染（时间列） | `test/sessions.test.ts`、`test/history-menu.test.ts` |
| 03 反馈+标题+泄漏 | webview 状态/渲染 + 纯函数（自动标题识别） | `test/chat-reducer.test.ts`、`test/chat-render.test.ts` |

- **TDD 红绿循环**：每票先红后绿；新用例注册进 `test/run.ts`；迭代期精跑 `node esbuild.mjs --tests; node --test --test-name-pattern "<用例名子串>" out/tests.cjs`（`--test` 前缀必须有）。
- **复现配方**（发现 A）：旧会话滚顶触发回填 → 点 + → 现状快照带旧消息（红）→ 修复后为空（绿）。
- **风险兜底**：`view.ts` 胶水层现有测试未覆盖；若 `vscode-stub` 接缝成本过高，sink 泄漏的行级修复以 code-review Standards 轴 + 手工验证兜底，不硬造低价值接缝。
- 交付前跑 `code-review` skill（Standards/Spec 双轴）+ pre-commit 全量验证（AGENTS.md 强制）。

## Out of Scope

- 拉取窗口偏差（top-100 按 updated）不改——Q4 已披露接受。
- HTTP 30s 超时值不动。
- 历史菜单打开期间的实时刷新——本来就不存在实时刷新，位置变动只发生在两次打开之间。
- `client()` 断连静默 no-op 的既有设计（`panel.ts:486` 注释：连接横幅兜底）不改。
- `refreshDiffs`/subagents 轮询守卫审计——审计确认已有"令牌+会话双检"，无同类洞。
- 服务器端标题治理——只做显示层识别，不改服务器数据。
- QuickPick placeholder 的英文硬编码（`historyPicker.ts:33`）——观感遗留，另行挂账。

## Further Notes

- **审计来源**：排序字段调研结论取自 opencode v2.3.2 源码（`anomalyco/opencode`，`store.ts:152-194`、`info.ts:53-54`）；新会话链路对抗审计对 v2.3.0 服务器活体实测：`POST /api/session` 返回非空标题 `"New session - <ISO>"`、响应无 agent/model 字段（`panel.ts:623` 的 `?? "build"` 兜底正常生效）。
- **断连静默路径**（`client()` undefined → `createSession` 静默返回）与 **HTTP 挂起 30s 窗**在审计中确认成立但非本用户症状（症状=旧消息残留）；点按即反馈（Q10a）对两者都是体验补齐，但不改其静默语义本身。
- **工票划分与阻塞边**：工票 01（翻页残留+守卫）、工票 02（创建序）互相独立、立即可做；工票 03（反馈+自动标题+泄漏）的"创建中"反馈建立在 `createSession` 行为正确之上，`Blocked by: 01`。
