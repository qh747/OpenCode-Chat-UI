import { useEffect, useRef, useState } from "react";
import type { SubagentJob } from "../src/util/subagents";
import { formatElapsed } from "../src/util/subagents";
import { t } from "../src/util/i18n";

interface SubagentStripProps {
  jobs: SubagentJob[];
  /** Clock override for tests; the strip ticks once a second otherwise. */
  now?: number;
  onStop: (childSessionID: string) => void;
  /** Open the child session in the chat (the history menu's switchSession path). */
  onOpen: (childSessionID: string) => void;
  /** The session currently on screen; a row for it must not re-switch (Q11). */
  currentSessionId?: string;
  /** Test hook: render with the rows expanded (default is collapsed). */
  initialExpanded?: boolean;
}

/**
 * How long a failed row stays pinned after the server's job list drops it
 * (spec D4). Inherited from the folding spec's slice-2 mechanism for finished
 * rows (approved as a 30s grey row, never shipped); here it holds a red one.
 */
export const HOLD_MS = 30_000;

interface HeldJob {
  /** The job as last seen; renewed while the server still lists it. */
  job: SubagentJob;
  /**
   * Epoch ms of the last sighting. The window counts from this moment, so it
   * renews every cycle while the job is listed and starts for real when the
   * server drops the row (工票 03：续期).
   */
  seenAt: number;
}

/** A hold entry is expired once HOLD_MS has passed since its last sighting. */
function isHeldExpired(entry: HeldJob, clock: number): boolean {
  return clock >= entry.seenAt + HOLD_MS;
}

/**
 * Subagents under the current session: one row per agent so the user can see
 * who is working, open the child session (subagent-nav) and stop a single
 * agent without cancelling the turn. Rows carry a status — running (blue
 * pulse), blocked on a permission reply (yellow), failed (red, held for 30s,
 * nothing left to stop). 默认只显示标题行（折叠），点击展开/收起（spec 分支
 * 5）；折叠态不持久化。
 */
export function SubagentStrip({
  jobs,
  now,
  onStop,
  onOpen,
  currentSessionId,
  initialExpanded = false,
}: SubagentStripProps) {
  const [tick, setTick] = useState(() => now ?? Date.now());
  const [collapsed, setCollapsed] = useState(!initialExpanded);
  const [held, setHeld] = useState<Map<string, HeldJob>>(new Map());
  /** 见过的 job id：出现新子代理时自动展开一次。 */
  const seenRef = useRef<Set<string>>(new Set());

  const clock = now ?? tick;

  useEffect(() => {
    if (jobs.length === 0 && held.size === 0) {
      return;
    }
    const timer = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [jobs.length, held.size]);

  useEffect(() => {
    const fresh = jobs.filter((job) => !seenRef.current.has(job.id));
    for (const job of jobs) {
      seenRef.current.add(job.id);
    }
    if (fresh.length > 0) {
      setCollapsed(false);
    }
  }, [jobs]);

  // error 行登记进 hold：在列表里就持续续期（seenAt = 最新见到的时刻），
  // 所以钉住的 30s 从服务器真正移除该行那一刻起算（工票 03：续期）——
  // 服务器留存多久都好，移除后窗口总是满的。
  useEffect(() => {
    setHeld((current) => {
      let changed = false;
      const next = new Map(current);
      for (const job of jobs) {
        if (job.status !== "error") {
          continue;
        }
        const existing = next.get(job.id);
        if (!existing || existing.job !== job || existing.seenAt !== clock) {
          next.set(job.id, { job, seenAt: clock });
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [jobs, clock]);

  // 过期行出栈，hold 不随会话无限增长。
  useEffect(() => {
    setHeld((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [id, entry] of next) {
        if (isHeldExpired(entry, clock)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [clock]);

  // 会话作用域（spec D4）：切换会话即丢弃 hold，30s 窗口不跨会话存活。
  const lastSessionRef = useRef(currentSessionId);
  useEffect(() => {
    if (lastSessionRef.current !== currentSessionId) {
      lastSessionRef.current = currentSessionId;
      setHeld(new Map());
    }
  }, [currentSessionId]);

  // 渲染行 = 服务器列表里的行 + 已从列表消失但 hold 未过期的失败行。
  const liveIDs = new Set(jobs.map((job) => job.id));
  const heldRows = [...held.values()]
    .filter((entry) => !liveIDs.has(entry.job.id) && !isHeldExpired(entry, clock))
    .map((entry) => entry.job);
  const rows = [...jobs, ...heldRows];

  if (rows.length === 0) {
    return null;
  }

  const hasFailed = rows.some((job) => job.status === "error");
  const hasBlocked = rows.some((job) => job.status === "blocked");
  const headTone = hasFailed ? " is-failed" : hasBlocked ? " is-blocked" : "";

  return (
    <div className="subagent-strip">
      <button
        type="button"
        className={`subagent-head${headTone}`}
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span className="subagent-chev" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="subagent-count">{t("subagentCount", { count: rows.length })}</span>
      </button>
      {!collapsed &&
        rows.map((job) => (
          <div
            className={`subagent-row ${job.status === "error" ? "is-failed" : `is-${job.status}`}`}
            key={job.id}
          >
            <span className="subagent-dot" aria-hidden="true" />
            {/* 行主体即按钮（subagent-nav）：跳转目标是该 job 的子会话；
                目标已在屏上时本地守卫吞掉点击，不重发 switchSession。 */}
            <button
              type="button"
              className="subagent-open"
              onClick={() => {
                if (job.childSessionID === currentSessionId) {
                  return;
                }
                onOpen(job.childSessionID);
              }}
              title={t("subagentOpenTitle")}
            >
              <span className="subagent-agent">{job.agent}</span>
              <span className="subagent-desc" title={job.description}>
                {job.description}
              </span>
              <span className="subagent-elapsed">
                {/* 失败行耗时冻结在 ended；服务器没报完结时刻（ended 缺省）
                    时退回时钟继续走表——边缘留待运行时观察。 */}
                {formatElapsed(job.started, job.status === "error" ? (job.ended ?? clock) : clock)}
              </span>
            </button>
            {/* 失败行没有可停的东西；阻塞行保留 Stop——停掉等权限的任务是合理操作。 */}
            {job.status !== "error" && (
              <button
                className="subagent-stop"
                onClick={() => onStop(job.childSessionID)}
                title={t("subagentStopTitle")}
                aria-label={t("subagentStopTitle")}
              >
                ×
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
