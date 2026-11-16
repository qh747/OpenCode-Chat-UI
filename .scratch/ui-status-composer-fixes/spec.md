# Spec: UI 状态呈现与 Composer 修复批次

日期：2026-11-17。来源：grilling 会话（全部决策已与用户确认）。

## 背景

一批 UI/交互问题的集中修复，共 9 个分支。所有决策在 grilling 中逐条确认，本文是权威记录。

## 分支 1：会话历史状态圆点改为标题着色

- 移除 `webview-ui/HistoryMenu.tsx` 中 `history-dot`（:102）与折叠行 `history-subagent-dot`（:106-109）。
- 标题（`.history-title`，:103）加条件 class 呈现状态：
  - working → `--ok` 绿；blocked → `--warn` 黄；failed → `--danger` 红；idle → 默认无色。
  - 折叠行 `runningChildren > 0` → 标题染 `--danger`（取代红色子代理点）。
- 状态颜色优先于选中/悬停高亮（`is-current`）；**会话自身状态色优先于 `has-running-children` 警示红**（grilling 决策 Q4：working 绿不被折叠行警示覆盖）。
- 空闲态标题与普通会话完全一致，无额外视觉区分。
- 所有动画（脉冲/扩散环）随圆点一起删除，只用静态颜色。
- 范围：仅 webview 渲染层；`src/util/sessions.ts` 与 `panel.ts` 的 `postHistory` 数据流零改动。

## 分支 2：`@数字@`（DCP id 标记）回显泄漏

- 来源：`@tarquinen/opencode-dcp` 注入的消息 id 标记被模型回显。
- 主因：`src/util/dcp-markers.ts` 的 `stripTrailingMarkers` 只剥"独占一行"的尾部标记；模型把标记粘在最后一句末尾（同一行）时漏剥。
- 修复：
  1. 剥离边界放宽为"行尾独立 token"（用户决策 Q15）：标记之后到文本末尾仅剩空白即剥离，**不限制标记前的前缀**——允许紧粘句尾（`。`）。已知误伤面仅剩"正文恰以 `@数字@` 结尾"，用户已接受。仅尾部位置，不做中段剥离（误伤风险高）。
  2. reasoning part（`MessageList.tsx:161` ThinkingRow）接入同一过滤。
  3. 导出/复制路径（`panel.ts:1066-1069`）接入同一过滤。
- 明确不做：正文中段 XML 标记残留（spec 既有记录项）。

## 分支 3：`@` 误触发文件补全卡死

- 现象：输入 `@`（非引用意图）后持续出现"没有匹配的文件"，Enter 无法发送。
- 根因（`webview-ui/Composer.tsx`）：触发正则 `/@([^\s@]*)$/` 只看文本尾部不看光标；列表为空不关弹层（:727-728）；`acceptActive` 空列表仍返回 true（:411-418）导致 Enter 被无条件劫持（:483-488）；Esc 抑制被任意一次 change 重置（:260）；无 IME composition 感知。
- 修复：
  1. 无匹配时自动关闭弹层，Enter 恢复发送；"没有匹配的文件"空态提示随之消失。
  2. 触发改按**光标前缀**（`text.slice(0, selectionStart)`）尾部匹配。
  3. IME composition 期间不触发/不重置补全模式。
  4. Esc 抑制存续到尾部 `@` 被删除或 `@` 后出现空格才解除。
  5. `/` 命令补全用同一套规则（含空态/Enter/触发）。

## 分支 4：子代理完成后绿点/三点残留

- 现象：查看已完成的子代理会话时绿点闪烁 + 底部三点常驻，切走即消失。
- 根因（`panel.ts`）：`switchSession()`（:519-534）不重置 `this.busy`；`refreshSessionMeta()`（:1592-1594）busy 单向置真；`postHistory()`（:981-983）用 stale busy 把当前打开的会话戳进 activeIDs。
- 修复：
  1. `switchSession()` 进入时 `this.busy = false`。
  2. `refreshSessionMeta()` 改双向重算 `this.busy = Boolean(time.busy) && !time.idle`。
  3. `postHistory` 的 activeIDs 戳记保留（修复后即准确）。
  4. 不给 `deriveSessionStatus` 加时效启发式（实测完成子会话的 `time.idle` 正常回写）。

## 分支 5：SubagentStrip 默认折叠

- 现状：`webview-ui/SubagentStrip.tsx` 无任何折叠逻辑，始终平铺。
- 修复：
  1. 组件级 boolean state，默认折叠；标题行（"子代理 N"）可点击切换，带 `▾/▸`（参考 `HistoryMenu.tsx:21,51-61,88-101` 模式，单列表用单布尔）。
  2. 新子代理启动时若折叠则自动展开一次。
  3. 不持久化（与 HistoryMenu 的内存 Set 策略一致）。
  4. 折叠态标题行加运行中脉冲指示（有 running 子代理时）。
  5. 调整 `styles.css:1065-1084` 相关样式（滚动限高语义随折叠调整）。

## 分支 6：AI 提问后 SubagentStrip 消失

- 根因：subagents 数据唯一来源是 2s 轮询（`panel.ts:1487-1514`）；回合结束分支（:1180）盲清 `clearSubagents()` 并停轮询。opencode 2.3.0 中子代理 job 与回合解耦（background，可跨回合存活），假设"回合结束 = job 结束"不成立。
- 修复：
  1. 回合结束不盲清：先最终 `refreshSubagents()`；仍有 running job 则保留轮询，直到全部结束才清停。
  2. `session.execution.started` / `session.step.started` 分支（:1163-1168）补 `startSubagentPolling()`（服务器拉起的 continuation 回合也能恢复 strip）。
  3. snapshot 覆盖语义（`state.ts:107`）不动。
  4. `[DEBUG-sub1]`/`[DEBUG-force1]` 探针暂留，本批次验证后再清。

## 分支 7：等待子代理时的输入框提示

- 决策：等待子代理结果（主回合已结束、仅子代理在跑）→ 输入框显示**默认 placeholder**（与空闲态一致）；主会话真正处理中 → 提示**完全不变**（含"Enter 加入队列"字样）。
- 机制：busy placeholder（`Composer.tsx:655,675`，i18n `composerPlaceholderBusy`）仅由 `state.busy` 驱动；2.3.0 task tool 为后台语义，"等待子代理" = 父会话 idle + 子会话 running，分支 4 修复后该窗口 busy 即 false → 默认文案自然达成。实施时验证该窗口 busy 恒为 false，如仍有残留路径则补守卫。

## 分支 8：等待子代理时不排队

- 现状：busy 时消息被本地扣留进宿主内存 queue（`panel.ts:549-555`），回合结束才投递。
- 决策（范围 A）：**排队仅发生在"主回合执行中"**（execution started→end 窗口）；"等待子代理"态（主回合已结束）下新消息**直接发送**（`sendNow` → 服务器接受为 steer 或开新回合，已核实服务器不检查 busy）。
- 本地队列机制与 QueueStrip UI **保留**（主回合执行中时的行为不变，与 Q31"真正处理中提示不变"一致）。

## 分支 9：图片粘贴需多次尝试

- 根因候选（两处都修）：
  1. paste 监听只挂在 textarea（`Composer.tsx:648-658`）——外部复制后焦点不在输入框时粘贴事件丢失。修复：上提到 webview window/document 级。
  2. `imageStaged` 一次性消费（`app.tsx:39-46` `consumedImages` ref）——chip 添加失败即永久丢失。修复：未消费不丢弃，保留至被消费或超时清理。

## 验证

- `npm run typecheck`（随改随跑）、单测文件随分支跑、`npm test` 全量收尾。
- UI 行为（分支 1/5/7）人工验证：绿/黄/红标题色、折叠交互、等待子代理 placeholder。
