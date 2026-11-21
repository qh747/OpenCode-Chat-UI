# 02 — Optimistic attachment rows

Status: resolved

Type: task

## Problem

The user reported: when sending a message carrying file attachments (e.g.
an image), the attachment row inside the bubble took a very long time to
appear.

The optimistic local bubble that `sendNow` posts carried no `files`
field, and the transcript renders nothing for an empty attachment list —
the placeholder showed its text alone. The only path that replaced it was
the debounced `refreshMessages`, whose triggers all live on the model
response side (`session.tool.*`, `session.step.*`, `session.idle`,
`session.execution.*`); nothing refreshed when the user's own prompt
landed. So the rows waited until the model started responding — for a
long prompt, minutes.

A one-shot probe against a self-hosted v2.3.0 server (2026-11-21,
`.scratch/attach-render/probe-files-store.cjs`) settled the diagnosis: the
server
already stores the user message — with the full `files` shape — within
the `/prompt` cycle, and the resolve response itself carries
`payload.files`. The store is fast; the panel's refresh was late.

## Approach

Two layers:

1. The placeholder bubble carries its own `files` (`StoredFileAttachment`
   shape, aligned with what the server stores — see the live-captured
   samples in `attachment-rows.test.ts`), assembled before the staged
   image data is deleted from the staging map, so the rows render on the
   send instant with zero network dependency: images inline their base64
   `data`, selections keep their `L<start>-L<end>` description, plain
   files keep their `file:` URI. The placeholder and the authoritative
   message render the same shape, so the swap never blinks the rows
   away.
2. After `client.prompt` resolves, `sendNow` schedules a zero-delay
   message refresh so the authoritative user message replaces the
   placeholder immediately.

## Tests

- `test/optimistic-attachments.test.ts`: staged image / selection /
  plain file each land in the placeholder bubble's `files`; the
  authoritative user message replaces the bubble right after the prompt
  resolves.
- `test/attachment-rows.test.ts`: an optimistic local bubble with
  `files` renders its attachment rows too (the webview channel is
  shape-agnostic about `local-` ids).

## Explicitly out of scope

- The auto-attached editor selection does not enter the placeholder's
  `files`: the user never attached it deliberately, and its row still
  arrives with the authoritative refresh.
- URL links are not attachments; they stay in the message text
  (`appendLinks`), matching the server.
