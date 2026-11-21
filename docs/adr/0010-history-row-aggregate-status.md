# ADR-0010: History rows aggregate status over the root and its subagent children

- Status: superseded by 0016 (2026-11-21 — the menu no longer shows subagent
  sessions, so there is nothing to aggregate; a root row shows only its own
  status)
- Date: 2026-11-18
- Supersedes: the 2026-11-17 diagnostic decision "running children paint the
  folded row red" (recorded in the `HistoryMenu.tsx` comment and the
  `ui-status-composer-fixes` spec, branch 1 / Q4)

## Context

The history menu folds subagent sessions under their root. A parent whose
subagent is running showed **red on the folded row** (a
`has-running-children` warning class) but **green or uncolored when
expanded** — the warning applied only to the folded row, and the expanded
row showed the root's own status only, which is idle while the parent turn
waits on a background subagent.

Red is the panel's "needs you" color (blocked permissions, failed turns).
Painting it for ordinary progress meant the most alarming color in the UI
was on during the most normal state of delegation, and it contradicted the
expanded view of the very same session.

## Decision

A root row's color — folded and expanded alike — aggregates over the root
session and all its folded children, by priority:

1. anything **blocked or failed → red** (blocked and failed share the
   single "needs you" red);
2. otherwise anything **working → green** (a running subagent counts);
3. otherwise the root's own state (idle → uncolored).

Child rows keep their own status colors; the `· N running` count text is
unchanged. The aggregation is a pure function on the fold data
(`aggregateRowStatus`), unit-tested alongside `deriveSessionStatus`.

## Alternatives rejected

- **Keep red for running children, fix only the expanded row.** Makes the
  two states agree by painting both red — the alarm color for normal
  progress stays, which is the complaint.
- **Blocked = yellow (the session-status palette), failed = red.** Two
  attention colors for one question ("does this need me?"); the single
  red answers it without a legend.
- **Leave expanded rows unaggregated.** The root row would show nothing
  while a child works — the bug report's second half.

## Consequences

- A delegating session reads as green in both states; red appears only
  when a child or the root is blocked or failed.
- `has-running-children` class and its CSS rule are deleted; the folded
  row is no longer special-cased in markup.
- The superseded 2026-11-17 decision is recorded here and in the
  `history-status-colors` spec; the `HistoryMenu.tsx` comment is rewritten
  to point at this ADR.
