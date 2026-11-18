# ADR-0011: Remove the plan handoff button

- Status: accepted
- Date: 2026-11-18

## Context

Plan mode rendered an always-on "▶ Proceed with the plan in build mode"
button whenever the session had messages and was idle — i.e. after every
assistant reply in plan mode, including mid-exploration exchanges. The
handler behind it was three lines: switch the session's agent to `build`
and send the fixed prompt "Proceed with the plan."

The button's job was to remind, but it fired on every turn, so it was
permanently visible noise rather than a timely affordance — exactly what
plan mode's read-only focus is supposed to avoid.

## Decision

Remove the button, the `executePlan` handler, the `executePlan` wire
message, the `proceedInBuild` i18n strings, and the README feature line
("Plan handoff"), in both languages. Executing a plan stays possible the
ordinary way: `Shift+Tab` to cycle to build mode, then ask the agent to
proceed — the plan is already in the session context, which is all the
removed handler ever relied on.

## Alternatives rejected

- **Keep the capability behind an explicit trigger (slash command or
  composer action).** Preserves one-click execution, but with no visible
  affordance discoverability is zero anyway — an invisible feature with
  maintenance cost.
- **Show the button only after a "real plan" turn.** Requires a reliable
  heuristic for "this reply was a finished plan"; every candidate (length,
  headings, mode markers) misfires, and a wrong guess is worse than none.
- **Keep the button but demote its styling.** Still on every turn; the
  complaint is the presence, not the size.

## Consequences

- Plan mode no longer renders a persistent call-to-action; the composer
  area after a plan reply is quiet.
- Executing a plan costs one extra manual step (mode cycle + a sentence).
- The README no longer advertises the handoff; `Shift+Tab` mode cycling
  remains the documented way to leave plan mode.
