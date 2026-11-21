# ADR-0016: History rows show only the root session's own status

- Status: accepted
- Date: 2026-11-21
- Supersedes: ADR-0010 (history rows aggregate status over the root and its
  subagent children), and with it the delegation-visibility problem ADR-0010
  was written to solve

## Context

The history menu no longer shows subagent sessions at all
(`.scratch/history-hide-subagents/`, 2026-11-21): the server's `parentID=null`
filter (live-verified on 2.3.2 — the literal string `null` returns roots only)
removes them before the menu is built, and the whole fold affordance
(caret, indented child rows, count badge, `· N running`) is gone. With no
children in the menu, ADR-0010's aggregation has nothing to aggregate, and a
green row would point at something the menu deliberately hides.

The user reversed course deliberately, in one sitting: a menu that is quiet
about delegation reads better than a colored row pointing at nothing visible,
especially now that the subagent strip above the composer carries the activity
signal (blue pulse while running, yellow when blocked on a permission, red for
30s after a failure) and the session-scoped signal is accepted (grilling S4).

## Decision

A history row's color is the status of the session on that row alone, as
computed by `deriveSessionStatus`: blocked → yellow, working → green, failed →
red, idle → uncolored. No aggregation over children; a subagent's state never
paints a root row. The menu stays silent about delegation by design.

## Alternatives rejected

- **Keep the working aggregation, drop only the red contamination** (a running
  child still paints the root green). Keeps half of ADR-0010 while the child
  rows are gone — the green has no visible cause in the menu, and the
  `· N running` text that explained it died with the fold.
- **Keep the aggregation and the fold.** Contradicts the hiding decision the
  same session pinned: subagent sessions are not menu content.
- **Paint root rows for child trouble (blocked/failed).** Rejected for the
  same reason as ADR-0010's original complaint in reverse: the menu would
  alarm about a state the user can only resolve in the chat surface, which
  already shows the permission card and the strip.

## Consequences

- A delegating session reads **uncolored** in the menu while its subagent
  works: the root's own turn waits on the child and `busy > idle` does not
  advance — this is exactly the state ADR-0010 was created to fix, now
  preferred on purpose. The chain is recorded here so a future reader does not
  "fix" it back a third time without this context.
- `aggregateRowStatus`, `foldSubagentSessions`, `rootToExpand` and their
  tests are deleted; `HistoryGroup` carries plain root rows.
- Child-session attention lives in the subagent strip (blocked yellow keeps
  Stop, failed red drops Stop and is held 30s after the server drops the job)
  and, globally, in VS Code notifications (permission requests on by default,
  errors off).
