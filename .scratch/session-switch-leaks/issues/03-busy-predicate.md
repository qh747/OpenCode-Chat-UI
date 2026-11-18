# 03 busy 谓词唯一事实：busy > idle

Status: resolved
Type: task

按 spec 分支 3 实施（TDD：先补失败用例）。验收：`refreshSessionMeta` 的 busy 改为 `(time.busy ?? 0) > (time.idle ?? 0)`，与 `sessions.ts` 的 `deriveSessionStatus` 规则一致；已完成回合（旧 idle 时间戳仍在）不误报 busy；在跑会话切回后快照 `busy: true`；`drainRestoredQueue`/`send` 不再受错误谓词影响。不建 per-session busy 缓存、不统一 postHistory 来源。

## Comments

### 2026-11-18

- TDD：`test/session-meta.test.ts`（新，注册进 run.ts）三条用例：busy>idle → true（红灯：旧公式 false）；busy<idle → false（旧公式偶然正确但理由错误）；time 空 → false。
- `panel.ts` `refreshSessionMeta`：谓词改为 `(result.data.time.busy ?? 0) > (result.data.time.idle ?? 0)`，注释引 ADR-0009。`drainRestoredQueue`/`send` 读同一 `this.busy`，随之修正。
- 单测 303 通过 0 失败，typecheck 通过。
