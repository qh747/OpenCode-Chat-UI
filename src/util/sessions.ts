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
 * 客户端创建序重排（spec Q7，session-stability 工单 02）：服务器
 * `GET /api/session` 只能按 `time.updated` 排序返回，行位会随活动跳动；
 * 拉取后统一改按 created 倒序——新建的排最前，位置此后不再移动。
 * 返回新数组，不改入参；created 相同时保持传入序（sort 稳定）。
 */
export function sortByCreatedDesc<T>(items: T[], createdOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => createdOf(b) - createdOf(a));
}

/** 按创建时间对会话列表分桶；桶序随传入序，调用方先用
 * `sortByCreatedDesc` 排好（spec Q7）。 */
export function groupSessionsByDate(sessions: SessionInfo[]): {
  label: string;
  sessions: SessionInfo[];
}[] {
  return groupByDate(sessions, (session) => session.time.created);
}

/**
 * 本地兜底（spec D1.2）：历史菜单只显示根会话。服务端 `parentID=null`
 * 过滤正常时子会话不会出现在页面里；参数被旧服务器忽略时在这里滤除。
 * 语义统一：parentID 非空 = 非 root = 隐藏（含根在页外的孤儿）。
 */
export function rootSessions(rows: HistoryRow[]): HistoryRow[] {
  return rows.filter((row) => row.parentID === undefined);
}

/** 按创建时间对历史行分桶（无折叠——ADR-0016；分桶键=created，
 * spec Q7：老会话刚有活动也不迁桶。桶内顺序=传入顺序，
 * 调用方先用 `sortByCreatedDesc` 重排）。 */
export function groupHistoryRowsByDate(rows: HistoryRow[]): {
  label: string;
  sessions: HistoryRow[];
}[] {
  return groupByDate(rows, (row) => row.created);
}

function groupByDate<T>(
  items: T[],
  timeOf: (item: T) => number,
): {
  label: string;
  sessions: T[];
}[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const updated = timeOf(item);
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

/** One row of the history menu. Root sessions only — the server filters
 *  children out via `parentID=null` and `rootSessions` is the local fallback
 *  (spec D1); the field stays so the fallback can tell them apart. */
export interface HistoryRow {
  id: string;
  title?: string;
  /** Set on subagent sessions; absent on root sessions. */
  parentID?: string;
  /** Epoch ms, creation time. */
  created: number;
  updated: number;
  status: SessionRunStatus;
}

/**
 * 服务器自动标题识别（spec Q11a，session-stability 工票 03）：服务器对新
 * 会话起 `New session - <ISO 时间戳>` 的英文自动标题（v2.3.0 活体实测），
 * 显示层命中时统一显示 t("newSession")，不命中原样降级、不改服务器数据。
 * 窄正则：只认这个精确形状（任一 ISO 秒精度），手起的近似名（无时间戳
 * 部分）不误伤。title 空缺回落 fallback。
 */
export function displaySessionTitle(title: string | undefined, fallback: string): string {
  if (
    title !== undefined &&
    /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(title)
  ) {
    return t("newSession");
  }
  return title || fallback;
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
