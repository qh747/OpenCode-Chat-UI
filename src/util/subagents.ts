import type { JobInfo } from "../opencode/types";

/** What a subagent row tells the user: in flight, stuck on a reply, or dead. */
export type SubagentJobStatus = "running" | "blocked" | "error";

/** A subagent, as the strip above the composer shows it. */
export interface SubagentJob {
  /** Job id — stable for the lifetime of one `task` tool call. */
  id: string;
  /** Session the subagent runs in; stopping means interrupting this session. */
  childSessionID: string;
  /** Display name of the agent, e.g. "General". */
  agent: string;
  /** What the agent was asked to do. */
  description: string;
  /** Epoch ms, for the elapsed readout. */
  started: number;
  /** running = in flight; blocked = waiting on a permission reply; error = the task failed. */
  status: SubagentJobStatus;
  /**
   * Epoch ms the job ended (errored jobs only), when the server reports it.
   * Present it freezes the elapsed readout; absent it keeps counting from the
   * strip's clock (edge case, 工票 03).
   */
  ended?: number;
}

/**
 * Mark in-flight rows blocked when their child session has a pending
 * permission reply across the server. The single owner of the blocked
 * mapping — `toSubagentJobs` applies it when given a set, and the host
 * re-applies it per refresh cycle via this export.
 */
export function withBlocked(
  jobs: SubagentJob[],
  blockedIDs: ReadonlySet<string>,
): SubagentJob[] {
  return jobs.map((job) =>
    job.status === "running" && blockedIDs.has(job.childSessionID)
      ? { ...job, status: "blocked" }
      : job,
  );
}

/**
 * Background jobs → the subagent rows worth showing. Shell and image jobs are
 * dropped: only subagents have a child session the user can stop. Completed
 * and cancelled jobs are dropped too — a finished agent is already represented
 * by its `task` tool part in the transcript, and a cancellation is the user's
 * own action. Errored jobs are kept: a failed agent is an attention signal the
 * strip holds for a while even after the server's job list drops it (spec D4).
 * `blockedIDs` carries the session ids with a pending permission reply across
 * the server (child sessions included); a running job whose child session is
 * in there is marked blocked. Without it every in-flight job reads running.
 */
export function toSubagentJobs(
  jobs: JobInfo[],
  blockedIDs?: ReadonlySet<string>,
): SubagentJob[] {
  const rows: SubagentJob[] = [];
  for (const job of jobs) {
    if (job.kind !== "subagent" || !job.childSessionID) {
      continue;
    }
    const base = {
      id: job.id,
      childSessionID: job.childSessionID,
      agent: job.agent || "subagent",
      description: job.description || job.title || "",
      started: job.time.started,
    };
    if (job.status === "error") {
      rows.push({ ...base, status: "error", ended: job.time.completed });
      continue;
    }
    if (job.status !== "running") {
      continue;
    }
    rows.push({ ...base, status: "running" });
  }
  return withBlocked(rows, blockedIDs ?? new Set());
}

/** Compact "how long has this been running" readout: 4s, 1m 05s, 1h 03m. */
export function formatElapsed(started: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
