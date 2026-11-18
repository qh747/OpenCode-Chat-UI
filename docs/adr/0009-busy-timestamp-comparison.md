# ADR-0009: Busy is a timestamp comparison, busy > idle

- Status: accepted
- Date: 2026-11-18

## Context

opencode v2's session `time.busy` / `time.idle` are persistent epoch
timestamps, not mutually exclusive flags: a session that has ever completed
a turn keeps its old `idle` timestamp forever, and the next turn sets
`busy` on top of it. Whether the session is running is a comparison
between the two numbers, not the presence of one and absence of the other.

The chat controller's `refreshSessionMeta` got this wrong:
`Boolean(time.busy) && !time.idle` is false for every session that has
ever finished a turn and is running again. Concretely: switch away from a
running session (the controller's single `busy` flag is reset on switch),
switch back, and the re-derivation — the only thing that can restore the
flag — computed `false`, so the composer showed the send arrow while the
model was still working. The same wrong value made the restored-queue
drain and `send()` treat a running session as idle.

The correct rule already existed in the repo (`src/util/sessions.ts`,
`deriveSessionStatus`: `busy > idle` means working) and was pinned by
`test/sessions.test.ts`.

## Decision

`refreshSessionMeta` derives `busy` with the same comparison:
`(time.busy ?? 0) > (time.idle ?? 0)`. The comparison is the single source
of truth for "is this session running"; no per-session busy cache is
introduced and `postHistory`'s `activeSessions()` map stays where it is.

## Alternatives rejected

- **Per-session busy state in the controller.** A second copy of a fact
  the server already answers authoritatively; it would drift exactly the
  way the global flag drifts today.
- **Consult `activeSessions()` on switch-back.** Its freshness depends on
  the history refresh cadence; the direct session read is fresher for the
  session actually being opened.
- **Trust event-stream busy events alone.** The stream is lossy by design
  (see the glossary); the session read is the resync point.

## Consequences

- Returning to a running session shows the stop button immediately; no
  dependence on a later `session.step.started` event to correct the
  display.
- Restored queues drain against a truthfully-idle session only, closing
  a "fire into a running turn" race.
- The rule lives in two places now (`sessions.ts` and the controller);
  both are pinned by tests so they cannot drift silently.
