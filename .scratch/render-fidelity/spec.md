# Chat rendering fidelity and typography

Status: batch 1 and batch 2 implemented, awaiting install verification

## Problem

The chat panel renders content in the wrong shape. Four distinct causes were
identified; two of them are defects, not taste:

1. **Streaming parts land in the wrong place.** `mergedMessages()` kept one
   text buffer per *message* and wrote it into the *last* text part, comparing
   lengths across different segments. A reply shaped `text → tool → text` could
   lose its first paragraph, duplicate it, or show the second paragraph above
   the tool card. Reasoning had the same logic with no `finish` guard, so the
   guess was written permanently into the host's message list.
2. **Markdown/CSS defects.** User messages are right-aligned, and
   `text-align: right` inherits into `pre`/`code`/`li`, so pasted code and
   lists are pushed to the right; `.msg.user .md p { margin: 0 }` collapses
   paragraphs; `h1..h4` are all 14px while `h5/h6/blockquote/hr/img/del` have no
   styles (images break the panel); tables have no horizontal scroll container.
3. **Missing output.** Tool failures show only a red ✗ (the failure reason is on
   the part, not in `metadata`); diff cards ignore the patch; markdown links are
   dead because nothing forwards clicks to `vscode.env.openExternal`.
4. **Performance.** Every delta re-rendered the whole tree and re-parsed the
   growing markdown (O(n²)); the host posted one message per token.

## Verified facts (v2 OpenAPI snapshot, opencode 2.3.0)

`dev/openapi.json` is authoritative for the event shapes; no live probe was
needed (the local account has no model balance, so a real turn cannot run):

- `session.text.started` / `session.text.delta` / `session.text.ended` carry
  `sessionID`, `assistantMessageID`, `ordinal`, and (delta/ended) `delta`/`text`.
- `session.reasoning.started` / `.delta` / `.ended` are the same shape.
- `session.message.content.updated` carries the **whole** content array of one
  message (`messageID`, `content`).
- Persisted content parts have **no id**: text/reasoning are `{ type, text }`
  only; tool parts have `id`.
- `Session.Message.ToolState.Error` has `error: { type, message, status? }`
  and optional `content` — the failure reason is on the state, not in
  `metadata`.
- The docs do not state whether `ordinal` counts every part of the content
  array or only parts of that kind. `locatePart()` accepts both readings.

## Decisions

| Decision | Choice |
|---|---|
| Streaming identity | Use the server's `ordinal`; never compare buffers across segments |
| Authority | `session.message.content.updated` > fetched parts > local deltas |
| Performance | Host coalesces deltas at 60ms; webview folds them into one dispatch per frame |
| Scope | Fix ordering + typography + obvious defects; syntax highlighting deferred |
| Typography direction | Proportional body text (`--font`), monospace only for code/paths |
| User message | Keep the right-aligned shell and rule; align its contents left |
| Structure | Compare per-message blocks against Turn grouping in a prototype |
| Delivery | Two vsix builds: correctness first, typography/tool cards second |

## Batch 1 — implemented

- `src/util/live-segments.ts`: `LiveStream` (per message, keyed by kind +
  ordinal), `locatePart()`, `mergeLiveContent()`.
- `text/reasoning.started|delta|ended` handled per ordinal; deltas coalesced and
  flushed before any full-message post and at turn end.
- `session.message.content.updated` accepted as the authoritative content.
- Turn-end pruning removes live state once the fetched message has `finish`.
- Webview: `textStarted`/`textDelta`/`textEnded`, `reasoning*`,
  `messageContent` reducer cases; part keys derived from kind + ordinal.
- `main.tsx`: deltas accumulate and dispatch once per animation frame.
- Markdown links open externally; stored attachment chips open their file when
  the attachment carries a `file:` URI; auto-scroll follows layout growth via
  `ResizeObserver`.

## Batch 2 — implemented (variant G)

The first prototype round (A–E) was rejected as "not good enough"; it invented a
look instead of borrowing one. The second round was built against three
shipping agents:

- **opencode desktop** ([opencode.ai/desktop](https://opencode.ai/desktop)) —
  bubble on the right, plain assistant text, `Used 1 Read` tool lines, dim
  `Thought for 4 seconds`, dim `Working`.
- **Command Code / Claude Code desktop** — tool and thinking rows with a small
  stroke icon, a muted label, a monospace target and a chevron on the far right
  that expands the output in place.
- **opencode / Claude Code TUI** — bullet rows with indented results.

Variant **G** (the Command Code look) won and is now in `webview-ui`:

- the user's message is a filled bubble on the right; its contents are left
  aligned, so pasted code and lists are readable again;
- tool calls are one line — icon, verb, monospace target, chevron — and expand
  in place; failures show `ToolState.Error.error.message`;
- thinking is its own row with the duration taken from the reasoning part;
- markdown: 13.5px/1.72, heading hierarchy, inline code as a chip, borderless
  code blocks with a language label and a copy button, tables in their own
  scroll frame;
- the per-message cost line is gone (the session cost is in the context strip).

Turn grouping was dropped: each assistant message is already one turn, and the
extra container only added chrome.

## Acceptance

Automated: `npm run typecheck && npm run lint && npm test`.

Manual (after `npm run release`):

- A reply containing `text → tool → text` keeps each paragraph in order, with no
  duplication and no paragraph above a tool card.
- Reconnecting mid-turn does not duplicate or shrink text.
- Pasted code blocks and lists in a user message are left-aligned and separated.
- Wide tables scroll inside the transcript, not the whole panel.
- Tool failures show a reason; markdown links open the browser.
- Long replies keep following the bottom while cards expand.

## Known limitations

- A part the server has not stored yet is appended at the end; if a tool part
  lands after it without an intervening refresh, the order is wrong until the
  next `content.updated` / refresh (typically < 1s).
- Ordinals are an extension-internal handle; they are never written back to the
  server.
