## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.
动手修已有工单覆盖的 bug 前，先读该 spec 与相关 issues 的 `## Comments` 追记——用户实录、升级条件与"观测到再升级"的约定都在追记里。

### Triage labels

The five canonical triage roles, using their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Verification

提交前的全量验证（lint/typecheck/test）由 pre-commit 强制执行。迭代期精跑受影响用例：`node esbuild.mjs --tests; node out/tests.cjs --test-name-pattern "<用例名子串>"`。
