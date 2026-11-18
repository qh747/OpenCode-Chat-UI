# 01 分支上下文显示:三层取真 + 事件真值覆盖

Status: resolved
Type: task
Blocked by: 02

按 spec「分支上下文覆盖状态」实施。分支条从"工作区分支"升级为"agent 工作上下文的分支":会话目录(≠工作区)> 本仓活跃 worktree > 工作区;主仓分支以 opencode 事件流为准(治疗 git 扩展降级环境的冻结),git 扩展保留 dirty 与离线兜底。

## 改动

1. **`src/util/branch-context.ts`**(新,纯函数):`resolveBranchContext(input)` —— 输入(工作区路径、工作区状态、事件分支、会话目录+分支、活跃 worktree),输出 `GitInfo`;按三层顺序取第一个有分支的来源,覆盖层不带 dirty、带 `directory`。
2. **`src/git.ts`**:导出 `readGitHead`(会话目录分支读取)。
3. **`src/webview/protocol.ts`**:`GitInfo` 增加 `directory?: string`。
4. **`src/webview/panel.ts`**:
   - 新状态 `sessionDirectory` / `worktree` / `eventBranch` / `postedGit`;
   - `handleEvent` 增加 `vcs.branch.updated`:目录=工作区 → 采纳 `eventBranch`、清 `worktree`;目录为本仓 worktree → 记 `{directory, branch}`;二者都触发 `publishGit`;
   - `refreshSessionMeta` 捕获 `location?.directory`,变化即 `publishGit`;
   - 会话身份变更四点(`createSession` / `switchSession` / `deleteSessionById` / `session.deleted`)同步清空分支上下文;
   - `fullResync` 清 `eventBranch`(服务器重连后以扩展真值重启);
   - `publishGit()` 等值跳过;快照 `git` 走生效值。
5. **`webview-ui/ContextBar.tsx` + `src/util/i18n.ts`**:分支段 tooltip 在 `directory` 存在时显示 `branchDirTitle · 目录`;键 `branchDirTitle` 双语(en:"Branch of the agent's working directory";zh-cn:"agent 工作目录的分支")。点击行为不变。

## 测试缝(TDD)

- `resolveBranchContext`:会话目录优先 / 分支缺失回退 worktree / 回退工作区 / 事件分支压过扩展分支 / 覆盖层无 dirty / 会话目录等于工作区时忽略(`test/branch-context.test.ts`)。
- 面板接线(真原型方法 + stub 控制器,`test/branch-events.test.ts`):worktree 事件翻转条带、主仓事件切回、`refreshSessionMeta` 捕获会话目录、`switchSession` 清空。
- `ContextBar` tooltip 与 i18n 键位(`test/context-bar.test.ts`、`test/i18n.test.ts`)。

## Comments

- 2026-11-19 实施完成,红绿顺序按计划走完。实施差异:会话身份变更点的覆盖清空改为**内联字段赋值**(与 busy 等显示态清理同风格),不新增方法依赖——既有 stub 测试零改动;`postSnapshot` 成为目标 git 的发布点并登记 `postedGit`,等值跳过防抖在快照与 {kind:"git"} 两种发布间保持一致。eventBranch 仅在 fullResync(服务器重连)清空,会话切换不清(它是工作区自己的最新真值,不属于会话)。span 形态仅在覆盖模式(directory 存在)才带 tooltip,默认形态与既有断言兼容。测试:branch-context(9 例)、branch-events(worktree 翻转/外部不达条/工作区切回+采纳事件分支/无分支或无目录忽略/等值去重/meta 捕获会话目录/switch 清空)、context-bar tooltip 三例。提交 e1b64f2、5c60e45、ff476f0。

## 红绿顺序

1. 红:`resolveBranchContext` 核心规则 → 绿:纯函数实现。
2. 红:面板 `vcs.branch.updated` 处理(worktree 翻转 / 主仓切回)→ 绿:面板状态 + `publishGit`。
3. 红:`refreshSessionMeta` 捕获会话目录并翻转 → 绿:meta 接线。
4. 红:`switchSession` 清空(条带回到工作区)→ 绿:四点清空 + `fullResync` 清 `eventBranch`。
5. 红:tooltip / i18n → 绿:协议 + ContextBar + i18n。

验收标准见 spec(用户亲述的三条复现路径)。
