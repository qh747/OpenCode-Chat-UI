# Spec: 分支条跟随 agent 工作上下文(worktree 分支显示修复)

日期:2026-11-19。来源:grilling 会话(`grill-with-docs`,全部决策已与用户确认;两轮问答见会话记录)。

## 背景

面板输入框下方的上下文条(`ContextBar`)显示的分支绑定 **VS Code 工作区文件夹**:`GitStatusProvider` 用内置 git 扩展 + `.git/HEAD` 兜底读工作区分支(`src/git.ts`),目录段也是工作区路径(快照 `workspacePath`)。agent 经 opencode 的 worktree 机制在其他分支上工作时,条上始终显示工作区分支(如 master)。

复现观察(用户亲述,当前环境可复现):

1. agent 在 worktree 分支上工作时,VS Code 左下状态栏显示 worktree 分支,面板条上始终显示 master;
2. 用户用 VS Code git 功能手动切换分支后,面板条仍停留 master —— 面板分支显示**缺乏活性**(与 `git.ts:129` 记录的已知降级吻合:部分环境内置 git 扩展仓库对象缺少 `onDidChange`,分支只在绑定时读一次后冻结)。

根因两层:条的真值绑定在"编辑器所在文件夹";而唯一能看见 agent 工作上下文的信号(opencode 事件流)被插件的目录过滤器整流丢弃。

## 实测事实(2026-11-19,一次性 opencode v2.3.0 服务器验证)

- SSE `vcs.branch.updated {branch}` 信封的 `location.directory` 即**发生分支变更的目录**:主仓 checkout 推送(目录=主仓);worktree 里切分支同样推送(目录=worktree 路径、branch=新分支),worktree 位于服务器 cwd 之外也推送(服务端监听解析到真实 gitdir `主仓/.git/worktrees/<name>/HEAD`)。VS Code 发起的 checkout 走同一 git → HEAD 变化链路,同样触发。
- `GET /api/vcs?directory=<worktree>` 对非服务器目录返回空 `branch` —— 拉式查询否决,worktree 分支的可靠来源是事件推送 + 插件本地读 `.git/HEAD`(`git.ts` 的 `readHead` 已会解析 worktree 的 `.git` 文件指针)。
- opencode v2.3.0 事件 schema 确认 `vcs.branch.updated`、`worktree.ready {name, branch}` 存在;worktree 创建触发分支创建 → `vcs.branch.updated` 已覆盖创建时刻(`worktree.ready` 语义未验证,不采用)。
- 事件过滤器(`events.ts`)按 `location.directory ≠ 工作区目录` 一刀切丢弃——worktree 信号今天到不了面板;若会话被 `session_move` 进 worktree,其后续**所有**事件(信封 location=worktree)都会被丢弃,面板将冻住(潜在 bug,同根因)。
- 数据库取证:用户历史会话全部锚定工作区目录(`session_move` 未发生过);worktree 由 agent 的 MCP 工具创建并注册。

## 决策(grilling 两轮确认)

| 问题 | 决策 |
|------|------|
| 分支条显示"谁的分支"(Q2) | **agent 工作上下文的分支**,三层取真:会话目录(≠工作区时)> 本仓活跃 worktree > 工作区分支 |
| 复现链路(Q1/Q1b/Q1c) | agent 以 MCP 工具建 worktree 并在其中工作,会话未搬家;worktree 仓库对 VS Code 可见而面板不可见;手动切分支面板不更新 |
| 主仓分支以谁为准(Q5) | **opencode 事件流为准**(不依赖可能缺失的 git 扩展事件),git 扩展降级为 dirty 来源 + 服务器离线时的兜底;事件与扩展不一致时事件更新者赢 |
| worktree 模式显示形态(Q6) | 只显示分支名,tooltip 带 worktree 完整路径;目录段保持工作区文件夹不变 |
| 切回时机(Q7) | 粘性:跟随最近一次属于(会话目录 / 本仓 worktree / 主仓)的分支信号;仅在切换/新建会话、或出现更新的主仓分支信号时切回 |
| dirty 星标(Q8) | worktree/会话目录模式下不显示(git 扩展对工作区外无仓库对象,不值得引 `git status` 子进程) |
| 会话搬移冻住(潜在 bug) | 同批独立工票修复(过滤放宽) |
| 文档(Q4) | GLOSSARY 3 词条 + ADR-0013 + 本 spec 与工票 |

## 设计

### 信号与过滤(工票 02,工票 01 的前置)

- `OpencodeEventStream` 的目录过滤从"单一目录等值"改为**谓词** `acceptsDirectory(eventDir)`:宿主的复合谓词 = 事件目录等于工作区,**或**事件目录可解析为本仓 worktree。无 `location.directory` 的事件维持放行(现状)。
- 本仓 worktree 判定(`src/git.ts` 导出 `WorkspaceWorktrees.isWorkspaceWorktree`):从 `directory` 向上找最近的 `.git`;是**文件指针**则解析 gitdir,gitdir 落在 `<workspaceRoot>/.git/worktrees/` 下即本仓 worktree;是目录(普通仓库)或找不到 → 否。只缓存命中(未命中逐次重查——agent 会在会话中途创建 worktree,未命中不能缓存)。
- 该规则同时放行 worktree 的 git 信号与被搬移会话的 `session.*` 事件(信封 location=会话目录=worktree),一处修复覆盖两病。

### 分支上下文覆盖状态(工票 01)

- 纯函数 `resolveBranchContext`(`src/util/branch-context.ts`)承载三层取真规则,输入全部为已解析数据(分支、目录、dirty),输出 `GitInfo`:
  1. 会话目录 ≠ 工作区且能读到分支 → `{branch, directory: 会话目录}`,不带 dirty;
  2. 否则活跃 worktree(目录 ≠ 工作区)→ `{branch, directory: worktree 目录}`,不带 dirty;
  3. 否则工作区真值:`{branch: 事件分支 ?? GitStatusProvider 分支, dirty: provider}` —— 事件分支覆盖扩展分支,扩展追平(相等)后撤销覆盖,治疗降级环境的冻结。
- 面板状态:
  - `sessionDirectory`:`refreshSessionMeta` 已经拿到、此前被忽略的 `result.data.location?.directory`;切换/新建/删除会话时同步清空(与 busy/messages 等 UI 态清理同点);
  - `worktree`:`vcs.branch.updated` 且目录经 `isWorkspaceWorktree` 判为本仓 worktree 时记录 `{directory, branch}`(分支缺失时以 `readBranch(directory)` 兜一次);
  - `eventBranch`:目录=工作区的 `vcs.branch.updated` 采纳;`fullResync`(服务器重连/权威重读)时清空,退回扩展真值。
- 发布:私有 `publishGit()` 计算生效值并与上次发布的值逐字段比较,变化才 `{kind:"git"}`;快照 `git` 字段同走生效值。git 扩展变化、worktree/主仓分支事件、会话目录变化、会话切换均触发。
- 协议:`GitInfo` 增加 `directory?: string`(分支所属目录,工作区时缺省);`ContextBar` 分支段 tooltip 用它(worktree/会话目录模式显示 `branchDirTitle · 目录`),点击行为不变。
- 版本门槛:事件需 server ≥ 2.3.0;旧服务器无事件 → 行为退化为现状(静默)。

## 已知局限(接受并记录)

- "最近一次信号优先"是启发式:用户手动在无关旧 worktree 切分支会把条带过去。本工作流中 agent 的 worktree 信号远多于人工操作;备选方案(按"会话开启后首次出现"限定)因面板重载后早建 worktree 失联而否决(ADR-0013)。
- 多根窗口下面板仍绑 `workspaceFolders[0]`(超出本批;agent 上下文语义已让条上显示"该看的真相")。
- 降级环境下 dirty 星标与 git 扩展一样可能滞后(仅主仓模式,影响面小)。
- 会话中途被搬移(`session_move`)要等下一次 meta 刷新(回合结束)才更新 `sessionDirectory`;期间 worktree 的分支信号已先行接管显示,实践中无缝。

## 验收标准

1. agent 经 worktree 在其他分支工作时,输入框下方显示该 worktree 分支(悬停见路径),回合中流式输出不受影响;
2. 用户在 VS Code 里手动切分支(主仓或 worktree),面板分支随之更新,不再停留 master;
3. (工票 02)会话被搬入 worktree 后,面板消息流不中断,分支显示跟随会话目录。

## 测试缝(tdd 约定)

- `resolveBranchContext`:三层优先级、dirty 抑制、分支缺失回退(纯函数,`test/branch-context.test.ts`);
- `WorkspaceWorktrees`:worktree 指针解析规则(伪造 `.git` 指针文件做夹具,`test/git-status.test.ts` 追加);
- `OpencodeEventStream` 谓词过滤:工作区放行 / 外部目录丢弃 / worktree 经谓词放行(stub fetch + SSE 流,`test/event-filter.test.ts`);
- 面板事件接线:`vcs.branch.updated` 与 `refreshSessionMeta` 的状态变更、会话切换清空(真 `ChatController` 原型方法 + stub 控制器,`test/branch-events.test.ts`);
- `ContextBar` tooltip 与 i18n 键位(`test/context-bar.test.ts`、`test/i18n.test.ts`)。
