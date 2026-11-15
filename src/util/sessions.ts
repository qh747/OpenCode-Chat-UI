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

/** Date-group a session list (newest first within groups). */
export function groupSessionsByDate(sessions: SessionInfo[]): {
  label: string;
  sessions: SessionInfo[];
}[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const age = now - session.time.updated;
    let key: string;
    if (age < dayMs && new Date(session.time.updated).getDate() === new Date(now).getDate()) {
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
    list.push(session);
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
  const result: { label: string; sessions: SessionInfo[] }[] = [];
  for (const key of order) {
    const labelKey = labels[key];
    const list = buckets.get(key);
    if (labelKey && list && list.length > 0) {
      result.push({ label: t(labelKey), sessions: list });
    }
  }
  return result;
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
