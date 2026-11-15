# ADR-0003: Address streamed content parts by the server's ordinal

- Status: accepted
- Date: 2026-11-15

## Context

A reply is a message whose `content` is an ordered list of parts: text,
reasoning, and tool calls. Only tool parts carry an `id`; text and reasoning
parts are `{ type, text }` and nothing else, so a delta arriving over SSE cannot
be matched to a part by identifier.

The previous design buffered the streamed text **per message** and, on each
message refresh, wrote that buffer into the message's **last** text part when it
was longer. That comparison spans different parts, so for a reply shaped
`text → tool → text` the first paragraph could be replaced by the second, the
second could be drawn above the tool card, and reasoning — merged without a
`finish` guard — was patched permanently into the host's message list. The
buffer was also never cleared at turn end.

The v2 event schema offers two handles: every text/reasoning event carries an
`ordinal`, and `session.message.content.updated` pushes the message's entire
content array. The schema does not say whether `ordinal` counts every part or
only parts of that kind.

## Decision

1. Use the event `ordinal` as the part handle, resolved by `locatePart()`:
   accept the direct content-array position when its type matches, otherwise
   fall back to the n-th part of that kind. Never compare text lengths across
   different parts; a fetched part that is longer wins, because that only
   happens after the server finished writing it.
2. Treat `session.message.content.updated` as the authoritative content and
   deltas as a smooth-rendering overlay that is valid only until the next
   authoritative update.
3. Prune live state when the fetched message has `finish`.
4. Keep the pull-based message refresh. It is the recovery path for a lossy
   event stream (see ADR-0002's consequences), not the primary renderer.

## Alternatives rejected

- **Keep the per-message buffer, compare by length.** Cheapest change, but the
  comparison is meaningless across parts; it cannot be made correct without
  identity.
- **Delta-only rendering, no message refresh.** Removes the ordering conflict
  entirely, but the event stream is explicitly lossy and tool parts only arrive
  through the message list, so a reconnect or a dropped event would leave a
  permanent hole.
- **Faster polling instead of deltas.** Always ordered, but costs a request per
  interval, loses the streaming caret, and re-renders the whole message on every
  tick.

## Consequences

- Text and reasoning can be placed precisely while the server is still writing,
  and are corrected rather than guessed once the server catches up.
- If the server's `ordinal` means something other than either reading above, the
  worst case is a momentarily misplaced new part, corrected by the next
  `content.updated`; no state is written back to the server.
- The host and the webview must agree on the ordinal→part mapping, which is why
  it lives in one shared pure module (`src/util/live-segments.ts`).
