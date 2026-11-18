import type { MessageInfo } from "../src/opencode/types";

/**
 * Scroll decisions for loading older transcript pages. Pure functions so the
 * panel behavior is testable without a DOM.
 */

/** A genuine scroll within this distance of the top counts as "at the top". */
export const TOP_THRESHOLD = 60;

export interface EarlierDecision {
  /** The server may still have older messages beyond the loaded pages. */
  hasEarlier: boolean;
  /** A backfill fetch of older messages is in flight. */
  loadingEarlier: boolean;
  /**
   * The scroll position of the user's last genuine scroll — programmatic
   * anchoring does not count — or undefined before any scroll happened.
   */
  lastUserScrollTop: number | undefined;
}

/**
 * The panel asks the host for older messages while the user's last real
 * scroll kept them near the top. Opening the panel (no scroll yet) never
 * auto-loads; a chain keeps running across prepends because the anchor
 * correction does not produce genuine scroll events, and it stops the moment
 * a genuine scroll moves away from the top.
 */
export function shouldRequestEarlier(input: EarlierDecision): boolean {
  if (!input.hasEarlier || input.loadingEarlier) {
    return false;
  }
  return input.lastUserScrollTop !== undefined && input.lastUserScrollTop < TOP_THRESHOLD;
}

/**
 * How far to shift scrollTop after older messages were prepended, so the
 * viewport stays on the same content. Only a true prepend (the previous first
 * message now sits deeper in the list) moves the anchor; appends at the
 * bottom and full replacements (session switches) do not.
 */
export function prependDelta(
  messages: MessageInfo[],
  prevFirstId: string | undefined,
  prevHeight: number,
  nextHeight: number,
): number {
  if (prevFirstId === undefined) {
    return 0;
  }
  const index = messages.findIndex((message) => message.id === prevFirstId);
  return index > 0 ? nextHeight - prevHeight : 0;
}
