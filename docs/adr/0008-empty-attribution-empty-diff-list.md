# ADR-0008: An empty attribution set means an empty diff list

- Status: accepted
- Date: 2026-11-18

## Context

The diff list is scoped per session by filtering the server's range diff
(`GET /api/session/{id}/diff?from&to`) against the session's attribution set —
the union of the files its own assistant snapshots list (`snapshot.files`).
The filter shipped with a fallback (0.4.21): when the attribution set was
empty, the whole range diff passed through unfiltered.

That fallback is a cross-session leak. The range diff is computed over the
shared working tree, so anything another session (or the panel's own
revert) does to the tree between this session's snapshot revisions lands in
its response. A session that never ran a turn — or ran only chat turns —
has an empty attribution set, and under the fallback it inherited exactly
those foreign rows: reverting `a.md` in session A showed up in session B as
`deleted a.md +0 -4`.

## Decision

An empty attribution set yields an empty diff list. The filter is
unconditional:

```ts
this.diffs = result.data.filter((diff) => wanted.has(diffFileKey(diff.file)));
```

The list means "this session's pending agent changes" and nothing else. A
session with no attributed changes shows an empty list; the user's own
manual edits were never revertable from it anyway (they have no
`before` content), so nothing of value is lost.

## Alternatives rejected

- **Keep the fallback.** It exists to show "something" for sessions the
  server has not attributed files to — but what it shows is other
  sessions' changes, which is precisely the bug.
- **Filter by tool calls instead of snapshots.** Tighter in theory, but
  misses files the agent wrote through other means (shell redirects), and
  the snapshot attribution is the server's own answer.
- **Suppress only `deleted` rows in foreign sessions.** Treats the one
  observed symptom, not the vector: a foreign `modified` row leaks just
  as easily.

## Consequences

- A fresh or chat-only session shows an empty diff list; the strip no
  longer flashes other sessions' files during a switch or a streaming
  turn whose snapshots have not arrived.
- If the server ever stops emitting `snapshot.files`, the list goes
  silent instead of going global — the failure mode is now "missing
  information", not "wrong information".
- The panel's own reverts still mutate the shared tree; other sessions'
  lists stay honest only because the filter now keeps foreign rows out.

## Revision (2026-11-19): per-message credibility

The core decision stands: an empty attribution set yields an empty diff
list. But the investigation ticket `server-snapshot-attribution/01`
(controlled experiments against a self-hosted v2.3.0 server — see its
`## Answer`) disproved this document's premise that `snapshot.files` names
the files the turn's agent touched. It is the shared working tree's content
delta inside one assistant message's own `[snapshot.start, snapshot.end]`
window: another session's turn, the panel's own revert, or a manual edit
that lands inside that window is recorded in that message's `files` even
when the message made no tool calls at all (`"tools": []`). Both observed
leak shapes — a foreign write inside a chat-only turn's window
(`modified a.md +1 -1`) and an external delete inside it
(`deleted a.md +0 -4`) — passed the strict filter, because the window noise
was itself the message's claimed attribution.

The "filter by tool calls" alternative rejected below is therefore revived
in its narrowest form: not a per-file tool-input cross-check, but
**per-message credibility**. `attributionSet` skips the snapshot files of
any assistant message that made no tool calls (`tools: []`): a message that
called no tool cannot have written anything itself, so every file its
window framed came from outside the turn. Messages that did call tools keep
full attribution — a real write goes through a tool, so no true row is
dropped, and the rejected alternative's shell-redirect false negative does
not apply at this width. Known second-order limitation: a tool-using
message whose window happens to frame a foreign write still serializes; if
that is ever observed, the next step is the per-file tool-input
cross-check.

## Revision (2026-11-21): per-file tool-input cross-check

The pre-registered upgrade condition fired: the user observed the
second-order leak repeatedly in practice — files the agent modified in
session A showed up in session B's diff list. Every observed row was
`modified` with the file present on disk, so the added-rows disk-truth
fallback never applied; the foreign write had landed inside a tool-using
message's snapshot window, and per-message credibility kept that
message's full `snapshot.files`.

`attributionSet` therefore narrows from per-message credibility to a
**per-file cross-check**. A tool-using assistant message now contributes
only the intersection of its `snapshot.files` with the write paths that
can be extracted cheaply from its own tool inputs: the `input.path` of
`write`/`edit` calls, read from the top-level `tools[]` list and from the
message's tool parts (`state.input`) — the two places a call's input
lives, united. Paths are compared through `diffFileKey` normalization
plus workspace relativization (an absolute `input.path` inside the
workspace matches the relative diff key). Legacy tool names (`bash`,
`apply_patch`, `task`) are normalized before classification.

The trade is deliberate and one-directional:

- A call whose input yields no cheap path — `shell`, `patch`,
  `execute`, or an unrecognized tool name — makes the message keep its
  full `snapshot.files`. A shell redirect is invisible to this check;
  the list may hide a true row, but never fabricates a foreign one.
- When both channels yield no calls at all (`tools` absent and no tool
  parts in the content), the message is unknown and keeps full
  attribution: missing means unknown, and unknown is trusted. An older
  server's messages have no `tools` field, so this covers them; if a
  `tools`-less message did carry tool parts, the parts still speak for
  the message and the cross-check applies.
- A message with `tools: []` remains dropped, as in the 2026-11-19
  revision.

Subagent parent sessions still pull no diffs at all; the cross-check
governs root sessions only. The failure mode is unchanged in kind:
missing information, never wrong information.
