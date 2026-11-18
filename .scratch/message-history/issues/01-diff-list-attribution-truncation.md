# Diff list attribution is computed over the newest message page only

Status: needs-triage

The same fetch truncation that hid the transcript's beginning also bounds the
diff list: `turnMessages` (`src/webview/panel.ts`) feeds `refreshDiffs` with a
single message page (server default: newest 50), so `diffRange`'s start time
and the attribution set (ADR-0008: empty attribution = empty list) only cover
those messages. In a long session, unprocessed file changes from older turns
can miss both the range and the attribution set, and never appear as pending
rows.

Glossary intent vs code: the **Attribution set** is defined as the union of
files in a session's own assistant snapshots — a whole-session concept — while
the implementation computes it over one page. Documented divergence.

Why not fixed alongside the transcript backfill (grilling session, 2026-11-19):

- The diff list sits inside ADR-0008/0012 semantics; widening the attribution
  set changes which rows appear (old pending changes would surface) and needs
  its own trust-boundary tests.
- `refreshDiffs` runs on event bursts with a 1.5s cache; looping the cursor for
  the whole history on every burst is a real cost.
- Backfilled transcript pages live in a separate store precisely so this
  input stays "newest page only".

Suggested direction when this gets picked up: give `refreshDiffs` its own
pagination loop with its own cache, and decide explicitly whether old pending
changes belong in the strip (that is an ADR-0010/0012 conversation, not a bug
fix).

## Comments
