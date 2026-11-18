# Spec — strips: 统一背景 / 文件名颜色 / 排队数

Validated by `prototype/strips` (variant **A · 整块平涂** won; gitignored
prototype directory, verdict recorded in its README). Source: user decisions
in the prototype thread.

The three strips above the composer — changed files (`DiffList`), queued
messages (`QueueStrip`), running subagents (`SubagentStrip`) — render as one
visual family with one flat tinted block per strip and no lines anywhere.

## Requirements

1. **统一背景（变体 A · 整块平涂）** — each strip is one flat tinted block
   (`--input-bg` at 55%, radius 6px, no border); no dashed row separators;
   row hover is a tint (`--fg` at 7%), never an underline (the changed-file
   hover underline is gone).
2. **输入框不显示排队数量** — the composer's `已排队 N` hint (`queued-hint`,
   `queuedCount` prop, `queuedHint` key) is removed.
3. **文件按修改方式上色、去文字前缀** — the bordered `新增/修改/删除` status
   badge is gone; each row encodes the type as `st-<status>` and the filename
   is coloured: added = green (`--ok`), modified = yellow (`--warn`),
   deleted = red (`--danger`).

## Follow-up decisions (applied to every strip)

4. Queue `↑` (send-now) is quiet (`--muted`), brightening to `--fg` on hover.
5. Queue `×` (remove) and the subagent stop button are both a red `×`
   (`--danger`, 13px, same hover tint as the file revert button); the
   subagent stop has no text.
6. The pulsing blue dot in the collapsed subagent header is removed (the
   per-row dot stays).
7. Queue row index is left-aligned with the strips' shared first column
   (10px edge), no fixed column width, so its gap to the message text is the
   same 6px as the subagent dot → agent gap.
8. The queue header's auto-send note (`turn 结束后自动发送`) is removed; the
   paused note stays (it pairs with the Resume button).
9. The changed-files header's `+x -y` total is removed; per-row `+x -y`
   stats stay.

## Out of scope

- Strip structure (mono header, caret, counts, per-row actions) unchanged.
- Collapsed-by-default behaviour unchanged.
- `webview-ui` only; no host-side (`src/webview`) changes.
