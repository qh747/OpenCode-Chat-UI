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
