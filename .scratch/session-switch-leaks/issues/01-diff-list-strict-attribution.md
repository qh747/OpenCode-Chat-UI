# 01 diff 列表严格归因：空归因即空列表

Status: resolved
Type: task

按 spec 分支 1 实施（TDD：先补失败用例）。验收：`touchedFiles` 归因集为空时 `this.diffs` 为空（删除 `wanted.size > 0` 的 passthrough 放行），服务器返回外来行不再串入；广播仍带当前 sessionID；有归因时的过滤行为不回归。

## Comments

### 2026-11-18

- TDD：`test/diff-refresh.test.ts` 新增"an empty attribution set shows an empty list, not foreign rows"（归因集为空 + 服务器返回 `a.md`），红灯确认（仅该用例失败，293 通过）。
- `panel.ts` `refreshDiffs`：删除 `wanted.size > 0 ? filter : passthrough` 三元，改为无条件 `result.data.filter(...)`，注释引 ADR-0008。
- 单测转绿（294 通过 0 失败），typecheck / 全量通过。
