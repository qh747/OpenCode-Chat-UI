# 02 revertFile 加固：会话校验 + 冲突不写盘

Status: resolved
Type: task

按 spec 分支 2 实施（TDD：先补失败用例）。验收：`revertFile` 消息带 `sessionID`，宿主 handleMessage 入口统一守卫、不匹配即丢弃（与 04 的会话戳共用）；`reverseApply` 失败时不写盘、post `revertConflict` 错误提示、文件保持原样；`deleted` 状态分支（重建写回）同样守卫；成功路径行为不变。

## Comments

### 2026-11-18

- TDD：`test/revert-file.test.ts`（新，注册进 `test/run.ts`）四条 revertFile 用例 + 两条守卫用例。红灯确认（冲突用例失败：现行代码把 patch 文本写进文件）。
- `vscode-stub.ts` 扩展 `Uri`（file/joinPath）与内存版 `workspace.fs`（`memoryFiles`/`trashedPaths`/`createdDirectories` + `resetFs`），仅测试构建 alias 生效。
- `panel.ts`：新增 `revertedContent()`（严格版 before 内容，失败返回 undefined）；`revertFile` 改用它，undefined → post `t("revertConflict")`、不写盘、不 dismiss；`deleted` 分支同样守卫。`openDiff` 保留 `beforeContent` 的 patch 文本 fallback（仅喂 diff 视图，不落盘）。
- 会话戳（与 04b 共用）：`protocol.ts` 动作类消息（send/removeQueued/forceQueued/resumeQueue/abort/stopSubagent/permissionReply/formReply/formCancel/revertFile）加 `sessionID?`，新增 `stampSession()` 与 `isStaleAction()`；`panel.ts` `handleMessage` 入口统一守卫；`main.tsx` 用 `sessionRef` 在 send 出口集中盖章。removeQueued 亦属队列动作，一并纳入盖章集。
- 单测 300 通过 0 失败，typecheck 通过。

### 2026-11-18（code-review 补充）

- Spec 轴发现验收缺口：`deleted` 分支的拒写守卫无用例。补"a deleted file with a stale patch refuses to recreate"（上下文携带的 deleted patch + 磁盘内容不匹配 → 不建目录、不写盘、报 `revertConflict`），锁定该验收行。
