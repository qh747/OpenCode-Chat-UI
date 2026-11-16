import { useEffect, useRef, useState } from "react";
import type { SubagentJob } from "../src/util/subagents";
import { formatElapsed } from "../src/util/subagents";
import { t } from "../src/util/i18n";

interface SubagentStripProps {
  jobs: SubagentJob[];
  /** Clock override for tests; the strip ticks once a second otherwise. */
  now?: number;
  onStop: (childSessionID: string) => void;
  /** Test hook: render with the rows expanded (default is collapsed). */
  initialExpanded?: boolean;
}

/**
 * Subagents running under the current turn. One row per agent so the user can
 * see who is working and stop a single agent without cancelling the turn.
 * 默认只显示标题行（折叠），点击展开/收起（spec 分支 5）；折叠态不持久化。
 */
export function SubagentStrip({ jobs, now, onStop, initialExpanded = false }: SubagentStripProps) {
  const [tick, setTick] = useState(() => now ?? Date.now());
  const [collapsed, setCollapsed] = useState(!initialExpanded);
  /** 见过的 job id：出现新子代理时自动展开一次。 */
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (jobs.length === 0) {
      return;
    }
    const timer = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [jobs.length]);

  useEffect(() => {
    const fresh = jobs.filter((job) => !seenRef.current.has(job.id));
    for (const job of jobs) {
      seenRef.current.add(job.id);
    }
    if (fresh.length > 0) {
      setCollapsed(false);
    }
  }, [jobs]);

  if (jobs.length === 0) {
    return null;
  }
  const clock = now ?? tick;

  return (
    <div className="subagent-strip">
      <button
        type="button"
        className="subagent-head"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span className="subagent-chev" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="subagent-count">{t("subagentCount", { count: jobs.length })}</span>
        {collapsed && <span className="subagent-pulse" aria-hidden="true" />}
      </button>
      {!collapsed &&
        jobs.map((job) => (
          <div className="subagent-row" key={job.id}>
            <span className="subagent-dot" aria-hidden="true" />
            <span className="subagent-agent">{job.agent}</span>
            <span className="subagent-desc" title={job.description}>
              {job.description}
            </span>
            <span className="subagent-elapsed">{formatElapsed(job.started, clock)}</span>
            <button
              className="subagent-stop"
              onClick={() => onStop(job.childSessionID)}
              title={t("subagentStopTitle")}
            >
              {t("subagentStop")}
            </button>
          </div>
        ))}
    </div>
  );
}
