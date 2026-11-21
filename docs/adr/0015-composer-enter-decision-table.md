# ADR-0015: Composer 的 Enter 决策表——光标在末尾才发送

- Status: accepted
- Date: 2026-11-21
- Validated by `prototype/enter-keys`（一次性原型，verdict 记于其 README；spec 分支 5）

## Context

用户把光标移到正文中间，输入 `/`（选 skills）或 `@`（选上下文）后按 Enter，
没有选中内容，反而把消息/命令发了出去。旧实现里三个缺陷叠加：

1. 命令分支的 `text.includes(" ")` 在接受高亮项**之前**就把整句当
   「命令 + 参数」抢先执行——正文第一个词被当命令名跑掉；
2. `@` 弹层行空（文件搜索未返回）时 `acceptActive` 失败后**落到发送**，
   整条消息被发走；
3. `acceptCommand` / `acceptSkill` 用 `setText("/name ")` 整体替换正文，
   即使接受成功也会抹掉已写内容。

别的 coding agent 的通用规则是：光标在输入末尾时 Enter 才发送；光标在中间时
Enter 只用于确认补全。用户在原型走查后定案采纳该规则，并另定两点：
`/` 支持任意光标位置触发；中途无菜单时 Enter 什么都不做（不换行）。

## Decision

Enter 行为收敛为一张纯函数决策表（`src/util/enter-keys.ts` 的 `resolveEnter`），
组件按动作执行：

| 场景 | 动作 |
| --- | --- |
| 菜单开 + 有高亮行（任意光标位置） | accept：光标处拼接（原位替换触发段，保留前后正文） |
| 菜单开 + 行空 + 光标中途 | none |
| 命令菜单行空 + 末尾 + 裸命令 `/cmd` | execute |
| 命令菜单行空 + 末尾 + `/` 在正文中间 | send（普通消息） |
| @ 行空 + 末尾 | send（`@` 作字面文本） |
| 无菜单 + 光标中途 | none（用户定案：不换行） |
| 无菜单 + 光标末尾 | 按 `opencode.composer.submitKey` 发送 |
| Shift+Enter | newline（浏览器原生，不拦截） |

配套约定：

- **`/` 任意位置触发**：`src/util/commands.ts` 的 `commandTail`，与
  `mentionTail` 同款的光标前缀尾部匹配。与 `@` 同时命中时的优先级：`@` 尾部
  活跃且 `/` 在其后输入（atIndex 更大）时命令菜单让位（`@路径/里的斜杠` 不会
  劫持文件菜单）；`/` 在前时命令菜单优先。已知取舍：URL 里的 `/` 也会触发。
- **带参命令 `/cmd args` 不走决策表**：空格会终止触发段，菜单根本不开，
  Enter 走无菜单分支发送，由 `doSend` 的 `startsWith("/")` 拆分执行——行为
  与旧版等价，但执行点单一。
- **接受一律光标处拼接**：`Composer` 的 `setTextAtCaret`（先同步 DOM 值与
  选区再提交 state，受控重渲不重置光标）；skill 插入后的 `@` 抑制位随拼接
  位置走。
- 中文输入法组合中的 Enter 由组件的 `isComposing` 守卫先行拦截，不进决策表。

## Consequences

- 光标中途的 Enter 永不产生副作用——用户在正文任意位置补 `/`、`@` 都安全。
- 「任意位置 `/` 触发」在 URL、路径等文本里会弹菜单，靠空格/查询无匹配收场；
  这是用户明选的取舍，备选的「行首/空白后触发」未采用（记录在原型 README）。
- 决策表的输入是纯快照（文本/光标/菜单/行数/高亮/修饰键），与 IME、DOM 解耦，
  由 `test/enter-keys.test.ts` 全表锁定；`test/composer-enter.test.tsx` 以
  真 DOM 锁定用户三症状。
