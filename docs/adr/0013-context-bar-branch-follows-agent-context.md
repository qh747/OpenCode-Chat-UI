# 0013 — 分支条跟随 agent 工作上下文,分支真值以事件流为准

日期:2026-11-19
状态:已接受

## 背景

上下文条的分支段绑定 VS Code 工作区文件夹(`GitStatusProvider`:内置 git 扩展 + `.git/HEAD` 兜底)。两重失真:

1. **看不见 worktree**:agent 经 opencode 的 worktree 机制在其他分支工作时,worktree 位于工作区之外,git 扩展与面板的 `.git/HEAD` 兜底都只看工作区,条上停留工作区分支(如 master)。opencode 事件流其实**推送**分支变更信号(`vcs.branch.updated`,信封 `location.directory` 即变更目录,worktree 在服务器 cwd 之外也推送,2026-11-19 实测),但插件的目录过滤器把"目录 ≠ 工作区"的事件整流丢弃——信号存在而不可达。
2. **分支显示可冻结**:`git.ts:129` 记录的已知降级——部分环境内置 git 扩展返回的仓库对象缺少 `onDidChange`,分支只在绑定时读一次;之后任何 checkout(含 VS Code 手动切分支)面板都不再更新(用户复现)。

## 决策

1. **条的真值 = agent 工作上下文的分支**,三层取真:会话目录(≠工作区)→ 本仓活跃 worktree → 工作区分支。覆盖层(前两层)不带 dirty 星标、tooltip 携带目录路径;目录段仍显示工作区文件夹(编辑器确实在那里)。
2. **分支真值以 opencode 事件流为准**:主仓分支同样采纳 `vcs.branch.updated`(git 扩展追平后撤销覆盖);git 扩展降级为 dirty 来源 + 服务器离线时的兜底。事件不可用的旧服务器(< 2.3.0)静默退化为现状。
3. **事件过滤放宽为"工作区或其 worktree"**:worktree 判定全部本地完成(`.git` 文件指针 → gitdir 落在 `<工作区>/.git/worktrees/` 下),不向服务器求证;同一规则顺带放行被搬移会话的 `session.*` 事件(信封 location=会话目录=worktree),修复"会话搬进 worktree 面板冻住"的同根因缺陷。
4. 切换粘性:跟随最近一次分支信号;仅在切换/新建会话、更新的主仓信号时切回工作区分支。

## 备选与取舍

- **git 扩展为准、事件只补 worktree**:改动最小,但治不了降级环境的冻结(用户已复现"手动切分支面板不动"),否决。
- **`GET /api/vcs?directory=<worktree>` 拉式轮询**:实测对非服务器目录返回空 `branch`,端点只为服务器自己的目录可靠,否决。
- **`worktree.ready {name, branch}` 作为 worktree 创建信号**:实测 `vcs.branch.updated` 在分支创建时刻即推送,创建场景已被覆盖;`worktree.ready` 语义未验证,引入只会多一条不确定路径,否决。
- **worktree 限定"会话开启后首次出现"**(替代"最近信号优先",防止用户手动在旧 worktree 切分支污染条):面板重载后,agent 早先创建的 worktree 不再"首次出现",会失联;现实噪声(agent 信号 ≫ 人工切 worktree 分支)很小,否决,记录为已知局限。
- **为 worktree 引 `git status` 子进程补 dirty 星标**:星标是锦上添花,不值得常驻子进程,否决。

## 后果

- 条上分支与 agent 实际工作分支一致,VS Code 状态栏与面板不再各说各话;降级环境的分支冻结被事件流治愈。
- 事件流成为分支真值的**活性依赖**:服务器断连时分支显示退回 git 扩展快照(可能滞后),dirty 同理——这是事件流既定的易失性(Event stream 词条)在本显示上的价格。
- "最近信号优先"是启发式:手动在无关旧 worktree 切分支会暂时带偏条;下一个信号(通常是 agent 的下一次 worktree 活动或主仓切换)即纠正。
