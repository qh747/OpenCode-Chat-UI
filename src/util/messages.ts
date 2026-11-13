import type { MessageInfo } from "../opencode/types";

/**
 * Sort a server message list into chronological (oldest-first) order.
 * The v2 message endpoint returns newest-first; the chat UI renders
 * oldest-first, so every fetched list must pass through here.
 */
export function orderMessages(messages: MessageInfo[]): MessageInfo[] {
  return [...messages].sort((a, b) => createdOf(a) - createdOf(b));
}

function createdOf(message: MessageInfo): number {
  const time = (message as { time?: { created?: number } }).time;
  return typeof time?.created === "number" ? time.created : Number.MAX_SAFE_INTEGER;
}
