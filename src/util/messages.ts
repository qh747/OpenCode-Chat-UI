import type { ListPage, MessageInfo } from "../opencode/types";

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

/** Query shape of the cursor-paginated message listing. */
export interface MessageListQuery {
  limit?: number;
  order?: "asc" | "desc";
  /**
   * Opaque cursor. The server rejects a request that carries cursor and
   * order together, so a follow-up page passes the cursor alone.
   */
  cursor?: string;
}

/** Page size when looping the cursor for a complete export. */
const COLLECT_PAGE = 200;
/** Safety cap: 1000 pages of 200 messages is far past any real session. */
const MAX_COLLECT_PAGES = 1000;

/**
 * The cursor that continues toward older messages. On a `desc` page
 * `cursor.next` anchors at the page's last (oldest) item and the next page
 * keeps walking down the newest-first timeline (verified against the v2.3.0
 * server's compiled handler). A missing cursor means the timeline is closed.
 */
export function olderCursorOf(page: ListPage<MessageInfo> | undefined): string | undefined {
  const next = page?.cursor?.next;
  return typeof next === "string" && next ? next : undefined;
}

/**
 * Union of two message sets by id, chronological. The incoming list wins for
 * a shared id (the fresh page is the server's authority); messages already
 * backfilled survive — a refresh must never drop them.
 */
export function mergeMessages(current: MessageInfo[], incoming: MessageInfo[]): MessageInfo[] {
  const byId = new Map<string, MessageInfo>();
  for (const message of [...incoming, ...current]) {
    const id = (message as { id?: string }).id;
    if (id === undefined || byId.has(id)) {
      continue;
    }
    byId.set(id, message);
  }
  return orderMessages([...byId.values()]);
}

/**
 * Walk the cursor until the timeline is exhausted and return every message in
 * server order (newest first, as the endpoint returns them). Only the first
 * page passes `order`; later pages pass the cursor alone. Termination is the
 * empty page — the server's own exhaustion signal, whose `cursor.next` is
 * absent — never a length heuristic, so server-side limit clamping cannot
 * silently truncate the collection.
 */
export async function collectAllMessages(
  fetchPage: (query: MessageListQuery) => Promise<ListPage<MessageInfo>>,
  options: { maxPages?: number } = {},
): Promise<MessageInfo[]> {
  const maxPages = options.maxPages ?? MAX_COLLECT_PAGES;
  const all: MessageInfo[] = [];
  let cursor: string | undefined;
  for (let fetched = 0; fetched < maxPages; fetched += 1) {
    const result = await fetchPage(
      cursor === undefined
        ? { order: "desc", limit: COLLECT_PAGE }
        : { cursor, limit: COLLECT_PAGE },
    );
    all.push(...result.data);
    if (result.data.length === 0) {
      return all;
    }
    cursor = olderCursorOf(result);
    if (!cursor) {
      return all;
    }
  }
  return all;
}
