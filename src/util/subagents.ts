import type { JobInfo } from "../opencode/types";

/** A running subagent, as the strip above the composer shows it. */
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
}

/**
 * Background jobs → the subagent rows worth showing. Shell and image jobs are
 * dropped: only subagents have a child session the user can stop. Completed
 * jobs are dropped too — the strip lists work in flight, and a finished agent
 * is already represented by its `task` tool part in the transcript.
 */
export function toSubagentJobs(jobs: JobInfo[]): SubagentJob[] {
  const rows: SubagentJob[] = [];
  for (const job of jobs) {
    if (job.kind !== "subagent" || job.status !== "running" || !job.childSessionID) {
      continue;
    }
    rows.push({
      id: job.id,
      childSessionID: job.childSessionID,
      agent: job.agent || "subagent",
      description: job.description || job.title || "",
      started: job.time.started,
    });
  }
  return rows;
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
