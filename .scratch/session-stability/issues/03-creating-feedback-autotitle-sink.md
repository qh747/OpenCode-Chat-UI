# 03 点按即反馈 + 新会话标题本地化 + sink 生命周期

Status: implemented
Type: task

**What to build**（用户视角）：点"+"后立即看到"创建中"内联反馈，新会话落地或报错后消失——慢网/服务器僵死时不再无声等待；新会话的自动英文标题在头部、历史行、QuickPick 三处显示本地化"新会话"；侧栏视图反复显示/销毁不留泄漏的 sink。

**Blocked by**：01（"创建中"反馈的 TDD 驱动 `createSession` 生命周期，需在翻页残留修复之后的干净行为上红绿；且两票同函数改动，串行落地避免摩擦）。

改动面（spec Q10/Q11 决策 + 审计附带 3）：
- 点按即反馈（Q10a）：`createSession`（`src/webview/panel.ts:588`）在首个 await 前发轻量"创建中"状态消息（新协议条目，`src/webview/protocol.ts`），新会话落地或错误后清除；webview 头部内联显示（`webview-ui/app.tsx` 头部区）。**30 秒超时值不动**。
- 自动标题本地化（Q11a）：显示层窄正则识别服务器自动标题 `New session - <ISO 时间戳>`（v2.3.0 活体实测格式；`app.tsx:346` 的 `??` 兜底永不触发），命中时三处统一显示 `t("newSession")`——头部（`app.tsx:346`）、历史行（`HistoryMenu.tsx:77`）、QuickPick 行（`historyPicker.ts:46`）；不命中原样降级，不改服务器数据。
- sink 泄漏（审计附带 3）：`src/webview/view.ts:76` 丢弃了 `bridgeWebview` 返回的 Disposable——保留并在 provider 销毁时 detach sink。

验收（TDD 先红后绿）：

- [x] 点 + 后、新会话落地前：宿主发出"创建中"状态消息；落地/报错后清除（先例接缝：宿主 harness）
- [x] webview 头部内联显示/消失该状态（先例：`test/chat-reducer.test.ts`、`test/chat-render.test.ts`）
- [x] 自动标题命中 → 三处显示"新会话"；不匹配串 → 原样显示（纯函数 + 渲染断言）
- [x] provider 销毁后 sink detach（`vscode-stub` 接缝若成本过高：该行级修复以 code-review Standards 轴 + 手工验证兜底，理由记录于 Comments，不硬造低价值接缝）
- [x] 新用例注册进 `test/run.ts`；全量验证通过

明确不做：断连静默语义本身（`client()` undefined 时仍静默，横幅兜底——契约见工票 01）；HTTP 超时值调整；QuickPick placeholder 英文硬编码（另行挂账）。

## Comments

**2026-11-22 实施（GLM）**：

- **协议形状**：HostToWeb 新条目 `{ kind: "creatingSession"; creating: boolean }`（protocol.ts，带成对发送的 doc 注释）；`ChatState.creatingSession` + reducer 直翻 case；i18n 新键 `creatingSession`（"Creating session…"/"创建中…"）。
- **宿主**（`panel.ts` createSession）：`client()` 判空后（断连静默契约保持——offline 用例锁死）立即 post true；成功路径在 postSnapshot 前撤、catch 路径在 error 横幅前撤。消息对用例进 `test/session-stability.test.ts`（复用既有宿主 harness；工厂加 `offline` 选项），3 用例：成功对、报错对、offline 静默。
- **自动标题**：`displaySessionTitle(title, fallback)`（`src/util/sessions.ts`）——窄正则 `^New session - <ISO>$`（秒精度 + 可选毫秒），命中返回 `t("newSession")`，空缺回落 fallback，其余原样。三处接入：头部（app.tsx，title attr 与显示文本都走显示串——原始 ISO 不在 tooltip 露出）、历史行（HistoryMenu.tsx，同样处理行 tooltip）、QuickPick（historyPicker.ts label）。QuickPick 行本身无渲染接缝（vscode QuickPick API 不入 DOM），一致性由共享纯函数保证——这是不为其单测的理由；纯函数 4 用例 + 头部/历史行渲染 3 用例锁死行为。
- **sink**：`view.ts` resolveWebviewView 保留 `bridgeWebview` 返回值、`view.onDidDispose(() => sub.dispose())`（镜像 openChatTab 先例）。**未走兜底**：vscode-stub 已有 Disposable/Uri，fake view（options/html 赋值 + onDidReceiveMessage/onDidDispose 记录）注入成本约 20 行，写了真用例（`test/session-creating.test.ts`：attach 1 次 → fire dispose → detach 收到同一 sink 对象）。
- **测试布局**：`test/session-creating.test.ts` 新文件（reducer ×1、头部渲染 ×2、自动标题 ×6 含 HistoryMenu 渲染、sink ×1 = 10 用例，注册进 run.ts）+ `test/session-stability.test.ts` 追加宿主 3 用例（harness 复用）。红绿：编译红（displaySessionTitle/creatingSession 条目不存在）→ 类型骨架先行（protocol/state 字段/i18n）→ 行为红 9 处逐条对上（stub 不识别 ×2、reducer default 忽略、头部无标签/露 ISO、HistoryMenu 露 ISO、宿主无消息对 ×2、sink 不 detach）；绿后 11 用例全过。
- **CSS**：`.header-creating`（muted 11px，styles.css，带出处注释）。
- 验证：全量 538 用例（527 + 11 新）全绿，`npm run typecheck` 过。
- 2026-11-22（code-review 记录）：`displaySessionTitle` 空值回落用 `title || fallback`，比工票描述的 `??` 语义宽——空串也回落 fallback（显示层健壮性）；v2.3.0 实测服务器标题恒非空，差异不可观测，采用宽回落。QuickPick label 的 `"Untitled"` 英文硬编码与 placeholder 同类，同挂账不做。
