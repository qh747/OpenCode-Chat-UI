# 03 — Tool cards, Turn grouping, code blocks

Status: ready-for-human

## Problem

- A failed tool shows a red ✗ and nothing else; `ToolState.Error` carries
  `error.message` and optional `content`, which are currently dropped.
- Arguments are rendered as a full JSON blob, and `pre-wrap` turns long single
  lines into dozens of soft-wrapped rows.
- Every assistant message renders as its own block with its own agent badge;
  the glossary's **Turn** has no visual grouping, so block spacing varies.
- Diff cards show only file name and line counts (intentional — the patch opens
  in the native diff editor).
- Code blocks have no copy affordance and no language label.

## Approach

Prototype two card shapes (single row vs two rows: tool + target, then a status
line), the failure-body treatment, and Turn grouping. Code copy uses a new
`copyCode` message handled by the host with
`vscode.env.clipboard.writeText`. Syntax highlighting stays out of this round.

## Resolution

Variant G won: tool calls are a single line — stroke icon, verb, monospace
target, chevron — and the output expands in place. Failures reuse the same row
with the label and icon in red and the server's message as the body. Thinking
got the same treatment ("Thought for N seconds", expandable). Turn grouping was
dropped: an assistant message is already a turn, and the container only added
chrome. Code blocks gained a language label and a copy button
(`copyCode` → `vscode.env.clipboard.writeText`); syntax highlighting is still
out of scope.
