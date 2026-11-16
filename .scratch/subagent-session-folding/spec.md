# Spec: fold subagent sessions under their root in the history menu

Status: in progress — slice 1 implemented, slice 2 not started

## Problem

Subagent sessions show up in the history list as peers of the session that spawned
them. The user asked for them to hang under the parent row, collapsed by default, and
for clicking one to open that subagent's session.

## Scope

This repository is the VS Code extension. Only its own surfaces are in scope:

| Surface | File | In scope |
|---|---|---|
| webview history dropdown | `webview-ui/HistoryMenu.tsx` | yes |
| native QuickPick | `src/views/historyPicker.ts` | yes |
| running-subagent strip | `webview-ui/SubagentStrip.tsx` | yes (slice 2) |
| desktop sidebar | `app.asar` (compiled, not this repo) | no — feature already exists there behind the `Subagents` toggle |
| TUI subagent panel | `@opencode/cli` binary (no source) | no |

Data facts that shaped the design:

- `SessionInfo.parentID` already exists (`src/opencode/types.ts:22`) but nothing in this
  repo read it before this change.
- `GET /api/session` accepts a `parentID` filter (`null` = roots only). The desktop app
  relies on it; this repo does not.
- Local DB at last check: `session_v2` has 33 rows, 3 with a non-null `parent_id`;
  the older `session` table has 9 rows, none with a parent.

## Decisions

1. One level of folding. Every descendant flattens into the nearest root; no nesting.
2. Expand inline in the row list, not in a side panel.
3. A root with children shows red dot + child count, plus `· N running` while any child
   works. The caret renders only when the count is above zero.
4. Child titles use the subagent `description`, falling back to `title`.
5. Search: out of scope for this repo — the webview menu has no search box, and the
   QuickPick deliberately hides child rows (decision 12).
6. Expand state is in memory only; a reload collapses everything.
7. Visual indent plus a count badge marks the child rows.
8. Roots sort by their own `updated`; child activity never promotes a root.
9. Children sort by `created`, oldest first.
10. The current session's root is force-expanded and its child row highlighted.
11. Clicking a child switches to that session (`switchSession`); no new tab.
12. The QuickPick shows roots only — it is a flat keyboard list and folding breaks
    arrow-key navigation.
13. `parent_id` absent means root. No heuristic pairing by title or time.
14. Fold before date grouping, so a child follows its root across day boundaries.
15. A child whose root is outside the fetched page folds as a root; the chain break
    point becomes the root for its own descendants.

## Implementation

Slice 1 — done:

- `src/util/sessions.ts`: `HistoryRow`, `FoldedHistoryRow`, `foldSubagentSessions`,
  `rootToExpand`, `groupFoldedByDate`; `groupSessionsByDate` now shares a private
  `groupByDate`.
- `test/sessions.test.ts`: 9 cases covering roots, direct children, orphans, multi-level
  chains, broken chains, root/child ordering, running count, forced expansion, and
  group-by-root-time.
- `src/webview/protocol.ts`: `HistoryGroup.sessions` is `FoldedHistoryRow[]`.
- `src/webview/panel.ts`: builds `HistoryRow[]`, folds, then groups.
- `webview-ui/HistoryMenu.tsx`: caret, count badge, indented children, current-row
  highlight, forced expansion.
- `webview-ui/styles.css`, `src/util/i18n.ts`: styles and copy.

Slice 2 — not started: finished-subagent rows kept grey for 30s in the strip, and a
`← from <root>` breadcrumb in the chat header.

## Deviations from the grilling answers

- The QuickPick filters child rows locally instead of asking the server with
  `parentID=null`. The server requires Basic auth that this repo resolves at runtime, so
  the filter could not be verified end to end; local filtering is equivalent and cannot
  break on an unverified response shape.
- "Search lists a matching child as its own result" has no surface here: the webview menu
  has no search input, and the QuickPick hides children by decision 12.
