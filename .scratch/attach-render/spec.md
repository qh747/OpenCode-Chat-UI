# Attachment rendering in sent messages

Status: implemented

## Question

A user message that points at a file, an image, a selection or a link used to
render every one of them as the same thing: a `📄 <name>` chip inside the
bubble. A pasted image never showed its picture, a selected range lost its
line numbers, and a link was a bare `参考链接: https://…` line in the text.

Should the presentation of a message's attachments change, and if so how?

## Facts established first

- The server keeps the whole attachment: `mime`, the base64 `data`, the
  `file:` URI it came from and the `description` the host wrote
  (`Prompt.FileAttachment` in `dev/openapi.json`). Nothing was being read
  from it but `name`.
- A selection carries its range twice — in `description` (`L120-L168`) and in
  the URI query (`?start=120&end=168`).
- A link has no attachment form: the prompt API resolves every attachment
  with `new URL()` and accepts only `data:` and `file:` URIs. The host
  already folded links into the message text as `参考链接: <url>` lines; the
  transcript just never read them back (ADR-0004).

## Prototype

`prototype/attach-render/` — four variants on one route, switched with
`?variant=baseline|A|B|C` or the bottom bar.

- **baseline · today** — one `📄 name` chip per attachment inside the bubble.
- **A · rows** — the bubble keeps the text; the attachments move below it as
  quiet rows: type icon (a real thumbnail for images), name, and a dim second
  line (path / range / size).
- **B · cards** — attachments become cards: images get a real thumbnail,
  files an icon card, links a domain card. The heaviest of the three.
- **C · compact** — one summary line (`附件 3 · CHANGELOG.md · screenshot.png`)
  with the full list behind a disclosure. The quietest of the three.

## Verdict

**C wins**, with links pulled out of the body into rows of their own.

The transcript is a reading surface, not a file browser: a message that
points at three things should cost one line until the reader asks otherwise.
A and B both make attachments compete with the text for attention, and B's
image cards take more room than a narrow panel wants to give them. C keeps
the bubble for the message and puts everything the message points at in one
quiet line under it.

Links are extracted from the message text rather than left in it. A link the
user attached and a link they quoted are different things, and after this
change they read differently: one is a row, the other is prose.

## What was implemented

- `src/util/message-attachments.ts` — one module both sides agree on:
  `appendLinks()` writes the marker lines, `extractLinks()` reads them back,
  `describeAttachments()` turns stored attachments into renderable rows.
- `webview-ui/MessageList.tsx` — the bubble holds the text; the attachment
  group sits under it, collapsed by default, expanding into a row per item.
  Images get a thumbnail from their own base64, a selection shows its range,
  a file opens in the editor, a link opens in the browser.
- `webview-ui/styles.css` — `.msg-group` and the `.attach-*` rules; the old
  `.chip-file` rules are gone.
- `test/message-attachments.test.ts` — the parsing round trip, the thumbnail,
  the range, the path. `test/chat-render.test.ts` — the rendered group.

## Open

- The `.chip-file` look was also used for the rewind affordance's
  neighbourhood; nothing else referenced it, so the rules were removed rather
  than kept alive.
- The prototype's variants A and B are on the throwaway branch, not in main.
