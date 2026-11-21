# Spec — Enter 键行为与面板加载层

Validated by `prototype/enter-keys`（提议决策表胜出）与 `prototype/loading-screen`
（变体 C 胜出；两目录均为 gitignored 一次性原型，verdict 记在各自 README）。
Source: 用户在原型线程里的定案（/ 任意位置触发；中途无菜单 Enter 什么都不做；
加载界面选 C）。

## 分支 5 · Enter 键：补全选择 vs 发送消息

用户症状：把光标移到正文中间输入 `/`（选 skills）或 `@`（选上下文）后按 Enter，
没有选中内容，反而把消息/命令发出去。根因是三个缺陷叠加：命令分支的
`text.includes(" ")` 抢先带参执行；`@` 行空时 accept 失败后落到发送；接受动作
整体替换正文。

**规则：光标在末尾才允许 Enter 发送；光标在中途只用于确认补全。**

决策表（`src/util/enter-keys.ts` 的 `resolveEnter`，纯函数）：

| 场景 | 行为 |
| --- | --- |
| 菜单开 + 有高亮行（任意光标位置） | 接受：在光标处拼接（原位替换触发段，保留前后正文） |
| 菜单开 + 行空 + 光标中途 | 无操作（不发送、不执行） |
| 命令菜单行空 + 末尾 + 裸命令 `/cmd` | 执行命令（带参形态 `/cmd args` 的触发段已被空格终止、菜单不开，经发送路径由 doSend 的命令拆分执行——行为等价，执行点单一） |
| 命令菜单行空 + 末尾 + `/` 在正文中间 | 按普通消息发送 |
| @ 行空 + 末尾 | 照常发送（`@` 作字面文本） |
| 无菜单 + 光标中途 | 无操作（用户选定：不换行） |
| 无菜单 + 光标末尾 | 按 `opencode.composer.submitKey` 发送 |
| Shift+Enter | 恒为换行（不拦截，浏览器原生） |

配套改动：

1. **`/` 任意位置触发**（`src/util/commands.ts` 的 `commandTail`，与
   `mentionTail` 同款的光标前缀尾部匹配）。优先级：`@` 已活跃且 `/` 在其后
   输入时命令菜单让位给文件菜单；`/` 在前时命令菜单优先。已知取舍：URL 里的
   `/` 也会触发，靠空格/查询无匹配收场。
2. **接受一律光标处拼接**（`Composer.tsx` 的 `setTextAtCaret`）：命令/skill 在
   触发段原位替换，文件移除触发段并附 chip；skill 插入后的 `@` 抑制位随拼接
   位置走（原来是硬编码 0）。
3. 中文输入法组合中的 Enter 由组件的 `isComposing` 守卫先行拦截，不进决策表。

锁定测试：`test/enter-keys.test.ts`、`test/commands.test.ts`、
`test/composer-enter.test.tsx`（真 DOM：中途无菜单不发送、@ 行空不发送、
末尾发送、末尾执行、高亮接受、拼接保正文）。

## 分支 7 · 面板加载层（变体 C · 极简进度条）

用户症状：插件新安装/冷启动时界面提前上屏——默认模型显示兜底「模型」、思考
深度选择器缺失。根因是目录竞态：server 的 agent/model 注册表在 `/api/info`
就绪之后才异步加载完，首个 catalog 拉取可能拿到空结果（`src/host.ts` 注释自
认），而首个 snapshot 携带的就是当时的空 catalog；旧的两道门
（`hydrated` / `catalogLoaded`）在空目录上就已放行。

**方案（变体 C）**：面板从第一帧就渲染（布局稳定），就绪前整体置灰不可点
（`.app.booting`），顶部 2px 不定进度条；就绪后进度条走满淡出、解除置灰。

就绪判据（`webview-ui/app.tsx`）：`connected && hydrated && catalog.models
非空 && 模型引用可解析`。配套：

1. 置灰期间不渲染选择器药丸——空 catalog 上屏时「模型」兜底字样不再闪现；
2. **10s 超时兜底放行**：坏服务器不得把用户锁死在加载层，放行后按现状降级；
3. **连接报错立即绕过**：不渲染进度条与置灰，横幅（重试/日志）直接显示；
4. 原来的首帧空白（`return null`）由加载层取代，首帧即见面板轮廓。

锁定测试：`test/first-paint.test.ts`（首帧置灰、目录竞态保持置灰且不渲染
药丸、完整快照一次成型解除置灰、报错直显）。

## Status

已实现（2026-11-21），全量测试 465 tests / 464 pass / 0 fail（Node 24）。
Enter 决策表已立 ADR-0015；新术语（Trigger tail / Enter decision / Boot
layer）已补进 GLOSSARY.md。双轴代码评审（Standards + Spec）已过：无硬性
违规；评审驱动的修正——就绪判据收紧为「引用可解析」、超时兜底对 starting
同样生效、优先级仲裁公式收敛为 `commandsWin` 单点、接受拼接收敛为
`spliceTrigger` 单点、`EnterState` 字段对齐 `shouldSend` 形状、进度条 900ms
与 CSS 过渡互引注释。
