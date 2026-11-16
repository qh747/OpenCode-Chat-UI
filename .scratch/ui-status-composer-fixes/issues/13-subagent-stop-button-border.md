# 13 子代理停止按钮去除边框

Status: resolved
Type: task

来源：用户装 vsix 人工测试反馈（附截图）：SubagentStrip 行内"停止"按钮有可见边框，要求去除。

## Comments

### 2026-11-17

- 跳过诊断环的说明：纯确定性 CSS 属性修改（去边框），无可断言的渲染属性 seam（静态 markup 不含计算样式），人工复验即可。
- `styles.css` `.subagent-stop`：删 `border: 1px solid var(--border)` 与 `border-radius: 4px`（无边框时无意义）；`:hover` 同步删 `border-color`，悬停反馈保留文字变红。
