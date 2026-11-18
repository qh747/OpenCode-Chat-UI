# Spec: 服务器 snapshot.files 归因边界调查

日期:2026-11-18。来源:`session-switch-leaks` spec 分支 1 遗留的「明确不做」项;0.4.21 修复后 B 跑过回合仍串行,新证据触发立项(Q11)。

## 问题

`GET /api/session/{id}/diff` 的区间是共享工作区上的;扩展用**本会话** assistant 消息的 `snapshot.files` 做归因过滤(ADR-0008,`src/util/session-diff.ts:44-55`),区间也只取本会话的 user message(`diffRange`)。扩展侧没有任何路径能把 A 的文件灌进 B 的归因或区间。0.4.21 后 B 仍显示 A 创建的文件 ⟹ **服务器把共享工作区的改动写进了 B 的 `snapshot.files`**。需要实证服务器的归因边界。

## 已知事实

- `src/opencode/types.ts:168-173` 注释:「`files` names the files the turn touched — the only per-session attribution the server exposes (the diff endpoint itself is turn- or range-based.)」
- diff 端点不带参数只 diff 最新 user message 那一轮;带 `from/to` 为会话区间(`.scratch/diff-visibility/spec.md` 修正节)。
- 扩展连**自身 spawn 的私有 server** 难以端到端观测(端口随机、内存内 Basic 密码,`.scratch/subagent-bugs-triage/spec.md`);调查应自建 server 实例(`opencode serve --port <p>` + 已知密码环境变量)直连观测。
- 排错期用户对 B 行状态的回答按预期给出、非亲见(grilling Q7);旧 Bug 1a 曾实证 `deleted a.md +0 -4` 形态。

## 待证事实

1. B 的 assistant 消息 `snapshot.files` 是否包含 B 的 agent 未碰过、而其他会话/用户在共享工作区改过的文件?
2. 若包含:归因窗口是什么(单回合窗口?会话首末消息区间?跨会话累积)?
3. 用户报告场景中 B 行的实际状态与 +/− 计数(钉死,替代排错期的预期回答)。
4. subagent 子会话的文件改动是否归入父会话的 `snapshot.files`?

## 验收

- `issues/01` 产出实证记录(实验步骤、观测原文、结论),逐条回答待证事实;无法建立的观测如实记录阻塞。
- 结论决定:归因过滤是否需要扩展侧加固(如与回合内 tool 调用交叉验证),或修订 ADR-0008 / GLOSSARY「Attribution set」词条。
