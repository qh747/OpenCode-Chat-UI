# 02 事件过滤放宽:工作区或其 worktree(会话搬移冻住修复)

Status: resolved
Type: task

按 spec「信号与过滤」实施。工票 01 的前置。

## 目标

- `OpencodeEventStream`(`src/opencode/events.ts`)目录过滤从"单一目录等值"放宽为谓词:事件目录等于工作区,**或**宿主谓词放行(本仓 worktree)。无 `location.directory` 的事件维持放行。
- worktree 判定 `WorkspaceWorktrees`(`src/git.ts`):从目录向上找最近 `.git`,是文件指针则解析 gitdir,落在 `<workspaceRoot>/.git/worktrees/` 下即本仓 worktree;命中永久缓存,未命中逐次重查(agent 会话中途创建 worktree)。
- 宿主(`src/host.ts`)接线:谓词 = 等值 `pathsEqual` 或 `isWorkspaceWorktree`;并把判定器暴露给面板复用。

## 测试缝

- `test/event-filter.test.ts`:stub fetch + SSE 流驱动真 `OpencodeEventStream`——工作区事件放行、外部目录默认丢弃、`acceptsDirectory` 放行 worktree 目录、无 location 事件放行。
- `test/git-status.test.ts` 追加 `WorkspaceWorktrees` 用例(伪造 `.git` 指针文件夹具:本仓 worktree / 外部 gitdir / 普通 `.git` 目录 / 无 `.git` / 事后补建指针)。

## 验收

被 `session_move` 进 worktree 的会话,其 `session.*` 事件不再被丢弃(面板不冻住);worktree 的 git 信号可到达面板(供工票 01 消费)。

## Comments

- 2026-11-19 实施完成:`acceptsDirectory` 谓词缝(events.ts),宿主以 `WorkspaceWorktrees`(git.ts)判定并接线,面板复用同一判定器。测试:`test/event-filter.test.ts`(stub fetch 驱动真 SSE 泵:工作区放行/外部丢弃/谓词放行 worktree/无 location 放行)+ `test/git-status.test.ts` worktree 规则五例(伪造 `.git` 指针夹具,含"事后补建指针仍放行"的无负缓存钉子)。全套 434 tests / 433 pass / 0 fail;typecheck、lint 干净。提交 f273078、b5f5d16。
