# ADR-0004: Links travel in the message text, and the transcript reads them back out

- Status: accepted
- Date: 2026-11-15

## Context

The prompt API accepts a message as a text plus a list of file attachments. A
file attachment must carry a `data:` or `file:` URI — the server resolves it
with `new URL()` and rejects anything else with "Unsupported attachment URI".
There is no attachment form for a link.

A link the user attaches to a message therefore has nowhere to go but the
text. The host already folded it in there as a `参考链接: <url>` line, but
nothing read it back: the link landed in the bubble as a bare line of text,
indistinguishable from something the user typed.

The alternative was to leave links in the text and show them as prose. That
means a message that points at a URL looks identical to a message that quotes
one, and the user cannot tell what the model was actually given.

## Decision

Keep folding links into the message text, and make it a round trip:

- the host writes them through `appendLinks()`, one `参考链接: <url>` line per
  link, at the end of the text;
- the transcript reads them back through `extractLinks()`, which strips those
  trailing lines off the body and hands the links to the attachment renderer.

Both halves live in one module (`src/util/message-attachments.ts`) so the
marker cannot drift between the two sides.

A link is then an **attachment** like any other: it appears in the collapsed
attachment summary under the message, and expands into a row of its own that
opens in the browser.

## Alternatives rejected

- **Leave links in the body text.** Simplest, and it is what the extension
  did before. A pasted URL then reads as prose, and the user cannot tell an
  attachment from a quotation.
- **Send links as file attachments anyway.** The server rejects non-`data:`
  and non-`file:` URIs, so this fails the request.
- **Keep a side channel of links in the host.** The transcript is built from
  what the server returns; a link that was never in the message would have no
  way back into a reloaded session.

## Consequences

- The body the user sees is the body the model was given, minus the link
  lines — which are shown as attachments instead of as prose.
- A link the user types by hand is *not* extracted: only trailing marker
  lines are, and only those the host wrote.
- The marker is a wire format between the host and the transcript, not a
  public contract. If it changes, both sides change together.
