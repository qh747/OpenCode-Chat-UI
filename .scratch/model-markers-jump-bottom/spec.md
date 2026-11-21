# Spec: 会话模型时间线 + 回到底部胶囊（model-markers-jump-bottom）

日期：2026-11-22。来源：grilling 会话（两轮 13 问，全部决策已与用户逐条确认，Q2/Q7/Q8 为用户显式选型、其余按推荐采纳）。实施：应用户指示直接在当前分支落地，未建 worktree。

## 需求（用户原始两条，逐字）

1. 「当用户将对话列表滚动到最顶端，不要显示已回到会话开始什么的提示。最开始的提示只显示用户在会话开始使用的是什么模型。如果中途更换了模型，也有显示更换后的模型。显示风格和现在已回到会话开始什么的提示的风格一致。」
2. 「当对话框内容很长，用户连续2次向下滑动滚轮时，出现向下的箭头提示，放在输入框的上方，如果输入框上方有文件改动列表什么的，那就放到这个的上方，点击后跳转到最新的对话内容」

## 事实（代码审计基线，2026-11-22）

- 顶部提示是**持久渲染**的分隔行 `.history-start`（`webview-ui/MessageList.tsx`），显示条件 `!loadingEarlier && !hasEarlier && visible.length > 0`，由历史分页耗尽驱动，非滚动事件瞬态；文案键 `historyStart`（zh「已到会话开头」），仅此一处引用。
- assistant 消息自带 `model?: ModelRef`（`src/opencode/types.ts`），全库 UI 无任何读取；会话级 `SessionInfo.model` 是「当前模型」，不是逐条历史。
- `.scroll-area` 此前**无任何 wheel 监听**（全库 grep 零命中）；「在底部」检测已存在（`stickToBottom`，40px 阈值）；`programmaticScroll` 标记区分程序滚动与用户滚动。
- 输入框上方条带栈自上而下：权限卡 → 提问卡 → 改动列表(DiffList) → 子代理条 → 队列条 → composer（`app.tsx` JSX 顺序）。
- webview 文案走 `src/util/i18n.ts` 双语字典（en 为键集、zhCn 补全），与 package.nls 无关。

## 决策（grilling Q1–Q13，全部用户确认）

- **Q1 顶部行内容**：只显示模型名，无附加信息（不加时间戳等）。
- **Q2 切换显示位置**：(a) 内联——在消息流切换点插入提示行（用户显式选择，否决顶部汇总变更链）。
- **Q3 触发与隐藏**：仅视口不在底部时滚轮下滑才计数；已在底部不计数；向上滚动清零计数；一旦到底立即隐没。
- **Q4 「连续 2 次」**：不限时，两次下滑之间没有上滚即算连续。
- **Q5 点击行为**：点击 → 平滑滚动到最新 → 胶囊立即消失；重现需重新满足条件；新消息到达不额外触发。
- **Q6 键盘**：本期不加（仅滚轮 + 点击）。
- **Q7 样式**：(b) 悬浮小胶囊、仅 ↓ 图标、不占布局空间（用户显式选择，否决条形提示）。
- **Q8 位置**：(a) 始终条带栈最顶端、紧贴消息列表下沿（用户显式选择）。实现用 `position: sticky` 挂在滚动容器内容末尾达成「悬浮不推移条带」。
- **Q9 格式与文案**：完整名 `providerID/modelID`；variant 不显示、不构成切换；文案 zh「模型: X」「已切换模型: X」/ en "Model: {model}" / "Switched to model: {model}"。
- **Q10 切换行样式**：直接复用 `.history-start` 样式类（风格一致字面成立）。
- **Q11 无 model 回退**：顶部行拿不到模型 → 整行不显示，**不**回退旧文案；无 model 的消息跳过、不参与切换比较。
- **Q12 胶囊水平位置**：居中。
- **Q13 计数口径**：按滚动量累计（`deltaY ≥ 240` ≈ 鼠标两格当量），上滚清零；触摸板按实际滚动量，滑得多才触发。

## 实现注记（编码期收敛）

- **类型收窄**：`MessageInfo` 的第三变体 `{type: string; id: string}` 无法被判别式 `!==` 排除（其 `type` 是 string），`modelSwitches` 用类型谓词 `isAssistant` 统一收窄。
- **scrollTo 断言语义**：点击传给 `scrollTo` 的是内容总高（`scrollHeight`），由浏览器钳制到底部；测试断言传参而非预计算的底部位置（首版断言写错已修正）。
- **钉底判定收编**：`onScroll` 里的字面 `40` 换成共享 `isAtBottom(el)`，与胶囊共用一个阈值语义。
- **评审收尾（Standards/Spec 两轴，2026-11-22）**：`hidePill()` 收敛三处胶囊重置三元组；共享测试工厂 `test/fixtures.ts`（Standards #2）；反转测试补修订出处注释（Standards #1，硬违规已修）；`.history-start` 类名保留（Q10 选型）但 CSS 注释写明双用途；测试头注释日期勘误；GLOSSARY 词条语病修正。
- **评审补记的三条行为事实（记录，不改行为）**：
  1. 胶囊渲染条件含 `hasMessages`——spec 外的良性防御：挡住会话切换瞬窗「胶囊还在、消息已清空」的一帧。
  2. Q13 的 240 当量按**像素口径**（`deltaMode 0`）；VS Code webview 即 Chromium 恒为像素，line 模式宿主不支持（`updateJumpWheel` 注释已写明前提）。
  3. 点击的平滑滚动是全库首个**连发 scroll 事件**的程序滚动：一次性 `programmaticScroll` 旗标只吞第一个，动画期后续事件按用户滚动处理（`stickToBottom`/`lastUserScroll` 随动画更新）。行为收敛无害——动画结束到底、不会误触 loadEarlier，happy path 已由测试锁定；若未来引入第二处 smooth 滚动，旗标需升级为时间窗/计数语义。

## What was implemented

（当前分支，2026-11-22；全量验证 typecheck 0 错 / 512 测试全过 / lint 0 问题。）

- **功能 1（模型时间线）**：新 `webview-ui/model-markers.ts`——`firstAssistantModel`（消息流第一条 assistant 的 model）、`modelSwitches`（相邻「有 model 的 assistant 消息」比较 providerID+id，切回同样记，无 model 跳过，variant 变化不算）、`modelLabel`（完整名）；纯函数，无新协议字段。`MessageList.tsx`：顶部行文本换 `modelAtStart`、无 model 整行不显示；切换行按消息 id 插在新模型第一条 assistant 正上方（Fragment 包裹），复用 `.history-start` 类；删除 `historyStart` 引用。
- **功能 2（回到底部胶囊）**：新 `webview-ui/jump-bottom.ts`——`BOTTOM_THRESHOLD=40`（与钉底共用）、`JUMP_WHEEL_DELTA=240`、`isAtBottom`、`updateJumpWheel`（到底隐没清零、上滚清零保显示、累计满阈值显示且粘住）。`app.tsx`：`.scroll-area` 加 `onWheel` 计数；`onScroll` 到底即隐没清零；点击 `scrollTo({top: scrollHeight, behavior: "smooth"})` 并置 `programmaticScroll`；`sessionID` effect 会话切换重置；胶囊按钮 sticky 居中于滚动容器内容末尾。i18n 增 `jumpToLatest`（zh「回到底部」/ en "Jump to latest"）。
- **样式**：`styles.css` 新 `.jump-bottom`（sticky、bottom 10px、30px 圆钮、z-index 10、hover 主题按钮色）。
- **测试**：新 `test/model-markers.test.ts`（8 用例）、`test/jump-bottom.test.ts`（7 用例）、`test/jump-bottom-pill.test.tsx`（5 用例，jsdom + createRoot + act 真实事件环，jsdom 无布局故 `defineProperty` 伪造滚动几何、`scrollTo` 用桩收集）；`test/history-backfill.test.ts` 的 markers 组重写（顶部行/切换行/无 model/未到底不显示，`setLocale("en")` 锁定断言字典）；三文件注册进 `test/run.ts`。
- **GLOSSARY**：新增「Model timeline」「Jump-to-bottom pill」词条。

## 边界（记录，不处理）

- 子代理视图不排除：胶囊与时间线在子会话同样生效，子会话有自己的时间线，行为一致。
- 「会话开始模型」取当前消息流第一条 assistant 的 model，回滚/分支后天然跟随新消息流。
- sticky 在内容末尾占一个流槽位（不推移任何条带，视觉悬浮）；严格的 absolute 方案需给 `.scroll-area` 加包裹层，弃。

## 明确不做（范围外）

- 无键盘快捷键（End / Page Down 不接线）。
- 新消息到达不触发也不隐藏胶囊（唯一隐藏路径：点击、到底、会话切换）。
- 顶部行不加时间戳/消息数等附加信息。
- variant 变化既不显示也不触发切换行。
- 不动 `.scroll-area` 的 DOM 结构（不加包裹层）。

## Open

- （无）本批范围收口。
