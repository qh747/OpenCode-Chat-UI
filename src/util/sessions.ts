import type { SessionInfo } from "../opencode/types";

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
  const labels: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    week: "Last 7 days",
    month: "Last 30 days",
    older: "Earlier",
  };
  const result: { label: string; sessions: SessionInfo[] }[] = [];
  for (const key of order) {
    const label = labels[key];
    const list = buckets.get(key);
    if (label && list && list.length > 0) {
      result.push({ label, sessions: list });
    }
  }
  return result;
}

export function relativeSessionTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}
