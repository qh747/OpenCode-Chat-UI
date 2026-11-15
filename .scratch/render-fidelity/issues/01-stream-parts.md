# 01 — Stream parts land in the wrong place

Status: ready-for-human

## Problem

`mergedMessages()` buffered text per message and wrote it into the last text
part, so a `text → tool → text` reply could lose, duplicate, or reorder its
paragraphs. Reasoning merged with no `finish` guard and mutated
`this.messages` in place.

## Change

- `src/util/live-segments.ts` — `LiveStream`, `locatePart`, `mergeLiveContent`.
- `src/webview/panel.ts` — ordinal-aware started/delta/ended handling, 60ms
  coalescing, `content.updated` as the authoritative content, turn-end pruning.
- `src/webview/protocol.ts` — `textStarted|textDelta|textEnded`,
  `reasoningStarted|reasoningDelta|reasoningEnded`, `messageContent` carry
  `messageID` + `ordinal`.
- `webview-ui/state.ts`, `webview-ui/main.tsx` — ordinal-based reducer cases and
  one dispatch per frame.

## Verification

`test/live-segments.test.ts`, `test/chat-reducer.test.ts`; manual scenario:
`text → tool → text` with a mid-turn reconnect.

## Comments

The event ordinal semantics are documented as an integer only; `locatePart`
handles both "index in the content array" and "n-th part of that kind".
