# 02 — Markdown and message typography

Status: ready-for-human

## Problem

- `.msg.user` sets `text-align: right`, which inherits into `pre`, `code`, `li`:
  pasted code and lists render right-aligned.
- `.msg.user .md p { margin: 0 }` collapses multi-paragraph messages.
- `h1..h4` are all 14px; `h5/h6`, `blockquote`, `hr`, `img`, `del` are unstyled;
  images have no `max-width`.
- `.md table` has no horizontal scroll container; `.scroll-area` lacks
  `min-width: 0`, so a wide table scrolls the entire panel.
- The streaming caret is a `::after` on `.md`, so it drops to the next line.
- Nested lists double their vertical margins.

## Approach

Keep the right-aligned user shell and its rule; reset alignment inside its
markdown. Body text becomes proportional (`--font`), monospace stays for code
and paths. Wrap tables in a scroll container. Render the caret inline after the
last streaming part.

## Resolution

The right-hand rule became a filled bubble (variant G). Typography: 13.5px body
at 1.72, heading hierarchy restored (h1 15px → h4 13px, h5+ inherited),
inline code as a chip, code blocks without borders but with a language label
and a copy button, tables in their own scroll frame, blockquote/hr/img/del
styled, nested lists without double margins. The streaming caret renders as the
last line's `::after` instead of a block after the last paragraph.
