import type { SessionInfo } from "../opencode/types";
import { t, type MessageKey } from "./i18n";

/** Four-state summary rendered as the history menu's status dot. */
export type SessionRunStatus = "idle" | "working" | "blocked" | "failed";

/** The session fields the status depends on; `SessionInfo` satisfies it. */
export interface SessionRunInfo {
  id: string;
  time: { busy?: number; idle?: number };
  outcome?: SessionInfo["outcome"];
}

/**
 * Blocked wins over running: a session awaiting a permission reply is stuck.
 * Running wins over the previous outcome, which still describes the last
 * finished turn while a new one is in flight. Everything else is idle — a
 * session that never ran, or whose last turn succeeded, shows no dot.
 */
export function deriveSessionStatus(
  session: SessionRunInfo,
  activeIDs: ReadonlySet<string>,
  blockedIDs: ReadonlySet<string>,
): SessionRunStatus {
  if (blockedIDs.has(session.id)) {
    return "blocked";
  }
  const busy = session.time.busy ?? 0;
  const idle = session.time.idle ?? 0;
  if (activeIDs.has(session.id) || busy > idle) {
    return "working";
  }
  if (session.outcome === "failed" || session.outcome === "interrupted") {
    return "failed";
  }
  return "idle";
}

/**
 * Fold subagent sessions under their root session. One level only: every
 * descendant is flattened into the nearest root's `children`.
 */
export function foldSubagentSessions(rows: HistoryRow[]): FoldedHistoryRow[] {
  const byId = new Map(rows.map((session) => [session.id, session]));
  const folds = new Map<string, FoldedHistoryRow>();
  for (const session of rows) {
    folds.set(session.id, { root: session, children: [], runningChildren: 0 });
  }
  const foldedInto = new Set<string>();
  for (const session of rows) {
    if (session.parentID === undefined) {
      continue;
    }
    const root = rootFoldOf(session, byId, folds);
    if (!root || root.root.id === session.id) {
      // The root is outside the fetched page or has no parent link: keep the
      // session visible as a root rather than dropping it (Q19).
      continue;
    }
    root.children.push(session);
    foldedInto.add(session.id);
  }
  return rows
    .filter((session) => !foldedInto.has(session.id))
    .map((session) => folds.get(session.id) as FoldedHistoryRow)
    .sort((left, right) => right.root.updated - left.root.updated)
    .map((fold) => {
      const children = [...fold.children].sort((left, right) => left.created - right.created);
      return {
        root: fold.root,
        children,
        runningChildren: children.filter((child) => child.status === "working").length,
      };
    });
}

/** Walk parent links to the topmost session; undefined when the chain is broken or cyclic. */
function rootFoldOf(
  session: HistoryRow,
  byId: ReadonlyMap<string, HistoryRow>,
  folds: ReadonlyMap<string, FoldedHistoryRow>,
): FoldedHistoryRow | undefined {
  let current = session;
  const seen = new Set<string>();
  while (current.parentID !== undefined) {
    if (seen.has(current.id)) {
      return undefined;
    }
    seen.add(current.id);
    const parent = byId.get(current.parentID);
    if (!parent) {
      // The chain ends outside the page: the session we stopped on is the
      // nearest root, so its own descendants still fold under it (Q19).
      return folds.get(current.id);
    }
    current = parent;
  }
  return folds.get(current.id);
}

/**
 * The root a collapsed menu must open on its own: the parent of the session the
 * user is currently in, so the menu never hides where they are (Q23).
 */
export function rootToExpand(
  folded: FoldedHistoryRow[],
  currentID: string | undefined,
): string | undefined {
  if (currentID === undefined) {
    return undefined;
  }
  for (const fold of folded) {
    if (fold.children.some((child) => child.id === currentID)) {
      return fold.root.id;
    }
  }
  return undefined;
}

/** Fold first, group second: a child must follow its root even across days. */
export function groupFoldedByDate(folded: FoldedHistoryRow[]): {
  label: string;
  sessions: FoldedHistoryRow[];
}[] {
  return groupByDate(folded, (fold) => fold.root.updated);
}

/** Date-group a session list (newest first within groups). */
export function groupSessionsByDate(sessions: SessionInfo[]): {
  label: string;
  sessions: SessionInfo[];
}[] {
  return groupByDate(sessions, (session) => session.time.updated);
}

function groupByDate<T>(
  items: T[],
  updatedOf: (item: T) => number,
): {
  label: string;
  sessions: T[];
}[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const updated = updatedOf(item);
    const age = now - updated;
    let key: string;
    if (age < dayMs && new Date(updated).getDate() === new Date(now).getDate()) {
      key = "today";
    } else if (age < 2 * dayMs) {
      key = "yesterday";
    } else if (age < 7 * dayMs) {
      key = "week";
    } else if (age < 30 * dayMs) {
      key = "month";
    } else {
      key = "older";
    }
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const order = ["today", "yesterday", "week", "month", "older"];
  const labels: Record<string, MessageKey> = {
    today: "group.today",
    yesterday: "group.yesterday",
    week: "group.week",
    month: "group.month",
    older: "group.older",
  };
  const result: { label: string; sessions: T[] }[] = [];
  for (const key of order) {
    const labelKey = labels[key];
    const list = buckets.get(key);
    if (labelKey && list && list.length > 0) {
      result.push({ label: t(labelKey), sessions: list });
    }
  }
  return result;
}

/** One row of the history menu, before subagent sessions are folded under their parent. */
export interface HistoryRow {
  id: string;
  title?: string;
  /** Set on subagent sessions; absent on root sessions. */
  parentID?: string;
  /** Epoch ms, creation time — orders siblings under a root. */
  created: number;
  updated: number;
  status: SessionRunStatus;
}

/** A root session plus the subagent sessions folded beneath it. */
export interface FoldedHistoryRow {
  root: HistoryRow;
  /** Descendants, one level deep, oldest first. */
  children: HistoryRow[];
  /** Children still working; drives the running badge on the collapsed row. */
  runningChildren: number;
}

export function relativeSessionTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return t("time.justNow");
  }
  if (minutes < 60) {
    return t("time.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("time.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return t("time.daysAgo", { count: days });
  }
  return new Date(timestamp).toLocaleDateString();
}
