# ADR-0013: Export pulls the whole session; the transcript loads history on demand

- Status: accepted
- Date: 2026-11-19
- Spec: `.scratch/message-history/spec.md` (grilling session, Q8/Q9)

## Context

The opencode v2 message listing is cursor-paginated; without parameters it
returns only the newest 50 messages. The panel used to ignore the cursor
entirely, so long sessions lost their beginning everywhere the message list
was consumed: the transcript, the export, and the session info stats.

Fixing completeness exposed an asymmetry that has to be decided on purpose:

- **Export** is a batch act with a batch contract: the file should hold the
  whole conversation. Nothing about it is interactive.
- **Transcript** is an interactive surface over sessions that can reach
  thousands of messages. Rendering every message on open costs first paint
  and memory for history the reader may never scroll into, and the renderer
  is intentionally unvirtualized.

## Decision

One data path, two loading policies:

1. **Export loops the cursor until the server reports exhaustion** (an empty
   page), collecting every message. It never truncates and never relies on a
   page-size heuristic. Page order stays the server's newest-first so the
   exported file keeps its existing presentation.
2. **The transcript opens on one page (the newest 100) and backfills older
   pages on demand** as the reader approaches the top. Backfilled pages are
   append-only: refreshes and turn ends never drop them, and the store resets
   on session switch and rewind. The recent window (the newest page) keeps
   feeding the diff list unchanged.

## Alternatives rejected

- **Loop the full history on session open.** Simple and absolutely complete,
  but first paint pays for potentially thousands of messages and the
  unvirtualized renderer keeps them all in the DOM afterwards.
- **Treat export like the transcript (lazy).** An export file silently
  missing old turns is a fidelity bug that a user cannot see while it
  happens — the worst place to hide truncation.

## Consequences

- Export and transcript completeness are independent tests; a regression in
  one does not masquerade as the other.
- Session info stats follow the loaded transcript, not the whole session;
  counts grow as the reader backfills. Accepted (known limitation).
- The diff list keeps reading the newest page only, so long sessions can
  under-report old pending changes — tracked separately in
  `.scratch/message-history/issues/01-diff-list-attribution-truncation.md`.
- The pagination semantics are load-bearing: the cursor of a `desc` page
  continues toward older messages, and a request must never pair the cursor
  with `order`. Both are pinned in `src/util/messages.ts` and its tests,
  verified against the v2.3.0 server handler.
