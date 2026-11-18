# Spec: 三个条的整行标题热区、子代理行跳转、子代理视图返回按钮（subagent-nav）

日期：2026-11-19。来源：grilling 会话（`/grill-with-docs`，全部决策已与用户逐条确认；权威决策记录另见 `~/.opencode/plan/subagent-nav.md`）。实施：应用户指示放弃 worktree、直接在 master 分支落地。

## 需求（用户原始三条）

1. 已修改文件列表、消息排队队列列表、subagent 子代理列表：标题热区增大为整个标题行，点击后展开或折叠。
2. 子代理列表里的子代理增加点击功能：点击跳转到子代理页面，与会话历史中查看子代理内容的方式一致。
3. 子代理界面左上方增加返回按钮，样式简洁不突兀，点击后返回。

## 事实（代码审计基线，2026-11-19）

- `DiffList`：`webview-ui/Cards.tsx`；热区仅 `.diff-toggle` 小按钮（caret + 计数），`.diff-head` 整行不可点。
- `QueueStrip`：`webview-ui/QueueStrip.tsx`；热区仅 `.queue-toggle`；暂停时标题行内有 Resume 按钮（`queue-head-btn`）。
- `SubagentStrip`：`webview-ui/SubagentStrip.tsx`；标题行**已是**整行 `<button class="subagent-head">`（`styles.css` width:100% / cursor:pointer）；数据行不可点，仅 × Stop（`stopSubagent`）。
- 三个条无共享折叠组件，各自管理状态；共享 CSS 家族在 `webview-ui/styles.css` strips 段。
- 会话切换原语 `{kind:"switchSession", id}`（`protocol.ts` → `panel.ts switchSession`）；**无同 id 守卫**，切到自己走完整「清空 → 早快照 → fullResync」；历史菜单同样无守卫（既有重刷行为）。
- `isSubagentSession`：host 由 `session.parentID` 推导（`refreshSessionMeta`），随 sessionMeta/snapshot 下发；parentID 本体未下发。
- 子代理视图现状：无返回机制；Composer 隐藏但保持挂载（issue 12）；QueueStrip 不渲染。
- `switchSession` 其他调用方：extension.ts 两处、fork 后跳转一处。

## 决策（grilling Q1–Q11，全部用户确认）

- **Q1 返回目标**：上一级父会话（`switchSession(parentID)`），嵌套时逐级返回；深度 1 即回到主会话。
- **Q2 显示时机**：当前会话有父会话即显示（复用 `isSubagentSession` 谓词），无论从子代理条跳入还是从历史菜单进入。
- **Q3 行内控件**：标题行整行可点后，行内已有操作按钮独占点击、不触发展开/折叠；整行 hover 高亮 + pointer；键盘 Enter/Space 可切换。
- **Q4 子代理行**：整行可点（agent + 描述 + 耗时包进一个 `<button>`，解决 div 内嵌 button 的合法性），× Stop 独占。
- **Q5 返回按钮样式**：纯图标 chevron，26px icon-btn 同规格，悬停出 tooltip；文案 i18n 双语。
- **Q6 持久化**：不新增——条展开/折叠状态管理一律不动。
- **Q7 位置**：`isSubagentSession` 时 header 最左的装饰 logo 方块替换为返回按钮；不加行高、零布局位移。
- **Q8 范围**：仅运行中 job 可跳（数据源即如此）；已结束子会话从历史菜单进。
- **Q9 SubagentStrip 标题**：不动（已是整行热区）。
- **Q10 文案**：zh「返回上一级会话」/ en "Back to parent session"——文案随 Q1 的「上一级」语义，嵌套时不撒谎。
- **Q11 同 id**：子代理条点击处本地守卫——目标已是当前会话就不发消息；历史菜单重刷问题留待单独 issue。

## 增补的文案键（subagentOpenTitle）

子代理行 title/aria 需要自己的 tooltip：zh「查看子代理会话」/ en "Open subagent session"（实现时按 Q5 同款 i18n 路径新增，属 Q4 的自然组成部分）。

## 增补（2026-11-19，评审后并入）

- **Q2 谓词精化**：实现按 `isSubagentSession && parentSessionID` 双重门控渲染返回按钮（host 两者同源于 `result.data.parentID`，实际不可分歧）；在 parentSessionID 尚未到达的瞬窗显示 logo 比显示一个无目标按钮更稳。spec 的 Q2 谓词在实践中由双重门控等效承载。
- **meta 显式语义（评审修正）**：`sessionMeta` 的 `parentSessionID` 改为缺席即清除（host 每条 meta 均整体下发该字段，`??` 保留模式会在切回根会话时留下脏 id，与双重门控构成隐性耦合）。测试同步翻转。
- **延后项（Standards 轴判断性意见，不在本批）**：三个条的头部可收敛为共享 `StripHead`（QueueStrip 因行内 Resume 不能 button 套 button 而形状略异）；真实 DOM 测试脚手架（mount/click）可提取共享 helper；`isSubagentSession` 与 `parentSessionID` 为一事实两字段，bool 有独立消费方（composer 隐藏），保留两字段。

## What was implemented

（master 分支，2026-11-19；基点 edd6224，与 history backfill 提交共存，panel.ts 两处 3-way 合并：`previousRevert` 与 `parentSessionID` 双保留、`renderableTranscript/hasEarlier/loadingEarlier` 与 `parentSessionID` 双保留。）

- **功能 1（整行热区）**：`Cards.tsx` DiffList 头部改为单个 `<button class="diff-head">`（对齐 `.subagent-head` 模式，caret + 计数为行内展示）；`QueueStrip.tsx` toggle 移到 `.queue-head` 行容器、`queue-toggle` 保留 `aria-expanded` 供键盘/读屏（click 冒泡恰 toggle 一次）、Resume `stopPropagation` 独占；`styles.css` 共享头部块升级为 `width:100% / text-align:left / cursor:pointer` 家族、hover 高亮并入行 hover 规则、删除 `.diff-toggle`。SubagentStrip 标题不动（Q9）。
- **功能 2（行跳转）**：`SubagentStrip.tsx` 行主体包进 `<button class="subagent-open">`，点击 → `onOpen(childSessionID)` → app 接线 `send({kind:"switchSession", id})`（与历史菜单同一机制）；同 id 本地守卫（Q11）；× Stop 独占。
- **功能 3（返回按钮）**：`panel.ts` 新增 `parentSessionID` 字段（createSession/switchSession 复位、refreshSessionMeta 取自 `result.data.parentID`），sessionMeta 与 snapshot 均下发；`protocol.ts` 两个消息面加可选字段；`state.ts` ChatState/initialState/applySnapshot/sessionMeta 接住（快照缺席即清除、meta 缺席保留）；`app.tsx` header 条件渲染——`parentSessionID` 存在时装饰 logo 让位给 `.icon-btn.header-back`（chevron-left，tooltip `backToParent`），点击 `switchSession(parentSessionID)`；i18n 新键 `backToParent`、`subagentOpenTitle`（en/zh-cn）。
- **测试**：新 `test/subagent-nav.test.tsx`（真实 DOM 反馈环：整行点击切换、toggle 单次性、Resume 独占、行跳转、同 id 守卫、Stop 独占、返回按钮显隐与 switchSession(parent)、parentSessionID 进 state 的四条协议面用例）；`session-meta.test.ts` 增 host 侧下发父 id 两用例；`diff-list.test.ts` 断言头即按钮且无 `.diff-toggle`；`subagents.test.ts` 适配 `onOpen` prop 并断言 `.subagent-open`。注册进 `test/run.ts`。
- **GLOSSARY**：新增「Parent session」词条；「Subagent job」补行跳转语义。

## 边界（记录，不处理）

- 父会话已被删除：返回按钮仍显示，点击走 fullResync 既有错误横幅；罕见，不特判。
- 返回主会话时队列条重置折叠：既有 `sessionChanged` 语义，不变。

## 明确不做（范围外）

- 宿主 `switchSession` 不加同 id 守卫（波及 extension.ts 三处调用方）。
- 不持久化条展开状态。
- 不扩展子代理条数据源（已结束 job 不列表）。
- 不动 SubagentStrip 标题行。
- 历史菜单同 id 重刷：单独 issue。

## Open

- （无）本批范围收口；历史菜单重刷与父会话删除两案留待后续 issue。
