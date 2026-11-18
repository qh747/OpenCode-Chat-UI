# Spec: 移除 PLAN 模式的 "以 build 模式执行计划" 常驻按钮

日期：2026-11-18。来源：grilling 会话（决策已确认；权威记录另见 plan 文件 `~/.opencode/plan/session-switch-leaks-0.4.21.md`）。

## 现象

PLAN 模式下，`agent === "plan" && !state.busy && hasMessages` 时常驻显示 `▶ 以 build 模式执行计划` 按钮（`webview-ui/app.tsx:314-318`）——plan 模式下**每条回复后都会出现**，构成常驻噪音。用户要求：PLAN 模式下不要显示该提示。

## 决策（Q12：选项 a，彻底删除）

按钮、能力、文案一起删干净：

- `webview-ui/app.tsx:314-318` 的按钮。
- `src/webview/panel.ts:370-372`（dispatch case）与 `panel.ts:943-952`（`executePlan()`）。
- `src/webview/protocol.ts` 的 `executePlan` WebToHost kind。
- `src/util/i18n.ts:181-182` 与 `:417-418` 的 `proceedInBuild`（英文/中文各一处）。
- `README.md:23` 的 "Plan handoff" 特性行与 `README.zh-CN.md` 对应行。

手动等价流程保留：Shift+Tab 切到 build 模式后说"执行计划"（计划内容本来就在会话上下文里，`executePlan` 本来也只是切 agent + 发一句话）。

- 对应 ADR：`docs/adr/0011-remove-plan-handoff.md`。

## 验证

- `npm run typecheck`；全量 `npm test`（检查 `test/` 是否有引用 `proceedInBuild`/`executePlan` 的用例并随之更新）。
- 人工验证：plan 模式下回复后不再出现按钮；Shift+Tab 循环模式不受影响。

## Comments

### 2026-11-18

- 全部移除完成：`app.tsx` 按钮块、`panel.ts` 的 `executePlan` case 与方法、`protocol.ts` 的 kind、`i18n.ts` 双语言 `proceedInBuild`、README.md / README.zh-CN.md 的 "Plan handoff / Plan 衔接" 特性行、`styles.css` 的 `.btn.plan-execute` 规则。
- `test/` 中无引用（grep 零残留），无需更新用例。
- typecheck / lint / 全量测试通过（315 通过 0 失败）。
