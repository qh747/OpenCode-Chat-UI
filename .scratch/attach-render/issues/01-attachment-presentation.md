# 01 — Attachment presentation in sent messages

Status: resolved

Type: prototype

## Problem

A sent message that points at something showed it as a `📄 <name>` chip, one
per attachment, inside the bubble:

- a pasted image never showed its picture;
- a selected range of lines lost its line numbers;
- a plain file, an image and a selection were indistinguishable;
- a link was not an attachment at all — it arrived as a bare
  `参考链接: https://…` line in the message text and read like prose the
  user had typed.

The data to do better was already there: the server keeps `mime`, the base64
`data`, the `file:` URI and the `description` of every attachment. Only
`name` was being read.

## Approach

Prototype four presentations on one route (`prototype/attach-render/`): the
status quo, a row per attachment below the bubble, a card grid, and one
collapsed summary line that expands into rows.

The question was not "can we show more" but "what does a message that points
at three things cost the reader". The transcript is a reading surface; a file
browser is not.

## Answer

**C · compact wins.** The bubble keeps the text; the attachments sit under it
as one collapsed line — `附件 3 · CHANGELOG.md · screenshot.png` — expanding
into a row per attachment. Images get a thumbnail, a selection shows its
range, a file opens in the editor.

Links are pulled out of the message text and become rows of their own, so an
attached link and a quoted one no longer read the same.

Implemented in `src/util/message-attachments.ts` (the module both sides
agree on), `webview-ui/MessageList.tsx` and `webview-ui/styles.css`. The
decision to round-trip links through the text is recorded in ADR-0004.

The variants as built are on the throwaway branch `prototype/attach-render`
(commit `c993756`, `prototype/attach-render/`), out of main. The branch is the
only copy that outlives the working directory: `prototype/` is gitignored, so
the files are not in main's history.

## Follow-up: the rows had to do something

The first implementation rendered the rows but left them inert: clicking a
pasted image did nothing (it has neither a path nor a URL, so nothing matched),
and a selection opened the file without the lines it pointed at.

The rule "what does clicking a row do" now lives in one place —
`attachmentTarget()` in `src/util/message-attachments.ts` — so it can be
tested without a browser:

| attachment | clicking it |
|---|---|
| pasted image | previews the image (it exists only as base64 in the message) |
| link | opens in the browser |
| file | opens in the editor |
| selection | opens in the editor, with those lines selected |

The image preview reuses the composer's existing preview overlay: the
attachment's base64 is already in the webview, so it needs no host round
trip. A file-backed image still opens in the editor, because it has a path.

The line range was lost because `onOpenFile` was declared with a single
parameter; the protocol has always carried `start`/`end` (`WebToHost`'s
`openFile`), and the composer already sent them.

The path also lost the drive letter's case: Chromium's `new URL()` upper-cases
it (`file:///h:/x` -> `/H:/x`) while Node's does not, so the case is read back
from the URI the server stored. Windows does not care, but the path shown to
the user should read like the one on disk.

## How this was verified

`scratchpad/click-loop.cjs` drives the real `dist/webview.js` in headless
Chrome over the DevTools Protocol, feeds it the payload a live
`opencode serve` actually stored, clicks every row, and reports what the
webview posted back to the host. It is what caught all three defects above —
`renderToStaticMarkup` cannot, because it drops event handlers.

