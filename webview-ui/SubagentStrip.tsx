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
 * Subagents running under the current turn. One row per agent so the user can
 * see who is working, open the child session (subagent-nav) and stop a single
 * agent without cancelling the turn.
 * 默认只显示标题行（折叠），点击展开/收起（spec 分支 5）；折叠态不持久化。
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
      </button>
      {!collapsed &&
        jobs.map((job) => (
          <div className="subagent-row" key={job.id}>
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
              <span className="subagent-elapsed">{formatElapsed(job.started, clock)}</span>
            </button>
            <button
              className="subagent-stop"
              onClick={() => onStop(job.childSessionID)}
              title={t("subagentStopTitle")}
              aria-label={t("subagentStopTitle")}
            >
              ×
            </button>
          </div>
        ))}
    </div>
  );
}
