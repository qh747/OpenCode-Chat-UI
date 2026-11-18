# Message history: complete transcript for long sessions

## Problem

When a session accumulates more than ~50 messages (≈15–25 turns), scrolling the
panel transcript to the very top does not show the session's beginning. The
first visible message is merely the 50th-newest one.

## Root cause (verified against the installed opencode v2.3.0 binary)

`OpencodeClient.listMessages` (`src/opencode/client.ts`) calls
`GET /api/session/{id}/message` with no query. The endpoint is cursor-paginated
with a default page of the **newest 50** messages (`order: "desc"`), and the
response's `cursor: { previous, next }` was modeled in `ListPage` but never
followed. The cap lived nowhere else: webview render, host snapshot and webview
state all pass messages through untruncated — the earliest messages never
entered the extension.

Server facts extracted from the v2.3.0 binary:

- `DefaultMessagesLimit = 50`; default order `desc` (newest first).
- The cursor is opaque (`{id, order, direction}`, base64url). A `desc` page's
  `cursor.next` anchors at the page's last (oldest) item and continues toward
  older messages.
- **`cursor` and `order` are mutually exclusive** — the server rejects a
  request that carries both ("Cursor cannot be combined with order").
- A non-empty page always encodes `cursor.next`; exhaustion is signalled by an
  empty page (whose `cursor.next` is absent). `data.length < limit` is a sound
  fast-path for "no more".

## Decisions (grilling session, 2026-11-19)

| Branch | Decision |
| --- | --- |
| Surface | The VS Code panel transcript. Server data is intact — this is a fetch-side truncation, not data loss. |
| End state | Scrolling near the top automatically backfills older pages; **no data may ever be lost from the transcript**. |
| Initial load | Keep a single initial page, size raised to 100; backfill follows the desc page's `cursor.next` (verified against the v2.3.0 binary: it anchors at the page's last, oldest item and continues down the newest-first timeline). |
| Merge rule | Backfilled pages are **append-only**: a refresh must never drop already-backfilled older messages (acceptance ⑤). Implemented as a separate `earlierMessages` store merged into the transcript view; the recent-window state keeps its current replace semantics so diff-list inputs (turn cache, attribution, diff range) stay untouched. |
| Exhaustion | The history closes only on the server's own signal — an empty page (`cursor.next` absent) — never on a length heuristic like `data.length < limit`, so server-side limit clamping cannot silently truncate. Small sessions therefore fetch one empty page the first time the user scrolls up; the "start of conversation" marker appears then. |
| Resets | Session switch and rewind (staged revert) drop the backfilled store; the store is refilled on demand. The revert point reported by session meta also resets it, covering reverts made outside the panel. |
| Export | `exportSession` loops the cursor until exhaustion (page 200, `order: "desc"` to preserve the existing newest-first presentation). Export is always complete. |
| Stats | Session info panel counts keep following the loaded set; no labeling (known limitation, accepted). |
| Tests | Host: pagination, merge retention, backfill guard, export loop, resets. Webview: state flags, markers, scroll-decision helpers (infra renders static markup only). |
| Acceptance | ① a >50-message session can be scrolled all the way to its first message; ② "loading earlier" indicator while backfilling; ③ "start of conversation" marker once the beginning is loaded; ④ prepending older pages keeps the scroll anchor stable; ⑤ refresh/turn end never drops backfilled messages. |

## Deliberately out of scope

The diff list's `turnMessages` fetch sees the same one-page cap, which bounds
`diffRange` and the attribution set for long sessions. It is a separate issue
(`issues/01-diff-list-attribution-truncation.md`): touching it changes
ADR-0008/0012 semantics and adds whole-history fetches on event bursts.
