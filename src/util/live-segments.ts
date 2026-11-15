import type { AssistantContent } from "../opencode/types";

export type SegmentKind = "text" | "reasoning";

type TextPart = Extract<AssistantContent, { type: "text" }>;
type ReasoningPart = Extract<AssistantContent, { type: "reasoning" }>;
type StreamPart = TextPart | ReasoningPart;

/** A text/reasoning part that is still being streamed. */
export interface LiveSegment {
  kind: SegmentKind;
  /** Server-assigned position among the message's parts of the same kind. */
  ordinal: number;
  text: string;
}

function keyOf(kind: SegmentKind, ordinal: number): string {
  return `${kind}:${ordinal}`;
}

/**
 * Text and reasoning parts of one assistant message, tracked while they stream.
 *
 * The server's persisted parts carry no identifier, so the ordinal from the
 * stream events (`session.text.started`, `session.reasoning.delta`, …) is the
 * only stable handle: it says which part of the message a delta belongs to.
 */
export class LiveStream {
  private readonly segments = new Map<string, LiveSegment>();

  get size(): number {
    return this.segments.size;
  }

  list(): LiveSegment[] {
    return [...this.segments.values()];
  }

  start(kind: SegmentKind, ordinal: number): LiveSegment {
    const key = keyOf(kind, ordinal);
    const existing = this.segments.get(key);
    if (existing) {
      return existing;
    }
    const segment: LiveSegment = { kind, ordinal, text: "" };
    this.segments.set(key, segment);
    return segment;
  }

  append(kind: SegmentKind, ordinal: number, delta: string): LiveSegment {
    const segment = this.start(kind, ordinal);
    segment.text += delta;
    return segment;
  }

  /** The server's closing event carries the part's full text; trust it over the deltas. */
  end(kind: SegmentKind, ordinal: number, text: string): void {
    this.segments.set(keyOf(kind, ordinal), { kind, ordinal, text });
  }

  clear(): void {
    this.segments.clear();
  }
}

/**
 * Find the part a stream ordinal points at.
 *
 * The API documents `ordinal` without saying whether it counts every part in
 * the content array or only the parts of that kind. Both readings are cheap to
 * support: prefer the direct array position when its type matches, otherwise
 * fall back to the n-th part of that kind. New parts are appended, so a miss
 * only costs a temporary position that `content.updated` corrects.
 */
export function locatePart(
  content: AssistantContent[],
  kind: SegmentKind,
  ordinal: number,
): number {
  const direct = content[ordinal];
  if (direct && direct.type === kind) {
    return ordinal;
  }
  let seen = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index]?.type !== kind) {
      continue;
    }
    if (seen === ordinal) {
      return index;
    }
    seen += 1;
  }
  return -1;
}

function partIndex(content: AssistantContent[], kind: SegmentKind, ordinal: number): number {
  return locatePart(content, kind, ordinal);
}

/**
 * Overlay live text/reasoning onto a fetched message.
 *
 * A live segment replaces the part at its ordinal, keeping that part's place in
 * the content array so a tool call between two text parts is not reordered; a
 * segment the server has not stored yet is appended at the end. The fetched
 * text wins when it is longer — that only happens once the server has finished
 * writing the part, and going backwards would make the reply shrink on screen.
 *
 * Returns new arrays and new parts; the input is never mutated.
 */
export function mergeLiveContent(
  content: AssistantContent[],
  stream: LiveStream,
): AssistantContent[] {
  const segments = stream.list();
  if (segments.length === 0) {
    return content;
  }
  const merged: AssistantContent[] = content.map((part) => ({ ...part }));
  const extra: StreamPart[] = [];
  for (const segment of segments) {
    const index = partIndex(merged, segment.kind, segment.ordinal);
    const target = index >= 0 ? (merged[index] as StreamPart) : undefined;
    if (!target) {
      if (segment.text.length > 0) {
        extra.push({ type: segment.kind, text: segment.text });
      }
      continue;
    }
    if (segment.text.length >= target.text.length) {
      merged[index] = { ...target, text: segment.text };
    }
  }
  return extra.length > 0 ? [...merged, ...extra] : merged;
}
