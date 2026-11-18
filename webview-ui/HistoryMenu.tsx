import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { HistoryGroup } from "../src/webview/protocol";
import { aggregateRowStatus, relativeSessionTime, rootToExpand } from "../src/util/sessions";
import type { FoldedHistoryRow, HistoryRow } from "../src/util/sessions";
import { t } from "../src/util/i18n";

interface HistoryMenuProps {
  dispatch: Dispatch;
  groups: HistoryGroup[];
  /** The session on screen; its root opens itself so the menu never hides it (Q23). */
  currentSessionId?: string;
  /** Called once when the menu opens so the host can fetch fresh sessions. */
  onOpen: () => void;
  /** 测试开口：初始展开的根会话集合（生产代码不传，等同空集合）。 */
  initialExpanded?: ReadonlySet<string>;
  /** 测试开口：初始即展开弹层（生产代码不传，等同 false）。 */
  initialOpen?: boolean;
}

/** Clock button + in-webview history menu anchored to the header button. */
export function HistoryMenu({ dispatch, groups, currentSessionId, onOpen, initialExpanded, initialOpen }: HistoryMenuProps) {
  const [open, setOpen] = useState(initialOpen ?? false);
  /** Roots the user opened by hand; in-memory only, so a reload collapses them again. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => initialExpanded ?? new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openMenu = () => {
    setOpen(true);
    onOpen();
  };

  const toggle = (rootID: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rootID)) {
        next.delete(rootID);
      } else {
        next.add(rootID);
      }
      return next;
    });
  };

  const switchTo = (id: string) => {
    dispatch({ kind: "switchSession", id });
    setOpen(false);
  };

  const hasSessions = groups.some((group) => group.sessions.length > 0);
  const forcedRoot = rootToExpand(
    groups.flatMap((group) => group.sessions),
    currentSessionId,
  );

  const renderRow = (session: HistoryRow, fold?: FoldedHistoryRow, indent = false) => {
    const isChild = indent;
    const canExpand = fold !== undefined && fold.children.length > 0;
    const isOpen = canExpand && (expanded.has(session.id) || session.id === forcedRoot);
    // 行状态聚合（ADR-0010）：有折叠子会话的行聚合自己与子代理的状态，
    // 折叠、展开一致——blocked/failed 红，否则任一 working 绿。推翻
    // 2026-11-17 “子代理在跑 → 折叠行红”的警示；红色只留给需要用户介入。
    const rowStatus =
      fold !== undefined && fold.children.length > 0
        ? aggregateRowStatus(session, fold.children)
        : session.status;
    return (
      <div
        key={session.id}
        className={`history-row-wrap${isChild ? " history-child" : ""}`}
      >
        <button
          className={`history-row${session.id === currentSessionId ? " is-current" : ""}`}
          onClick={() => switchTo(session.id)}
          title={session.title}
        >
          <span
            className={`history-caret${canExpand ? "" : " is-empty"}`}
            aria-hidden="true"
            onClick={
              canExpand
                ? (event) => {
                    event.stopPropagation();
                    toggle(session.id);
                  }
                : undefined
            }
          >
            {canExpand ? (isOpen ? "▾" : "▸") : ""}
          </span>
          {/* 状态直接用标题颜色表达，不再渲染独立圆点（spec 分支 1）；
              有折叠子会话的行用聚合状态（ADR-0010）。 */}
          <span className={`history-title status-${rowStatus}`}>
            {session.title || t("untitled")}
          </span>
          {fold !== undefined && fold.children.length > 0 && (
            <span className="history-subagents">
              {fold.children.length === 1
                ? t("historySubagentCountOne")
                : t("historySubagentCount", { count: fold.children.length })}
              {fold.runningChildren > 0 &&
                ` · ${t("historySubagentRunning", { count: fold.runningChildren })}`}
            </span>
          )}
          <span className="history-time">{relativeSessionTime(session.updated)}</span>
        </button>
        <div className="history-actions">
          <button
            className="history-action"
            title={t("renameTitle")}
            onClick={() => {
              dispatch({ kind: "renameSession", id: session.id, currentTitle: session.title });
              setOpen(false);
            }}
          >
            ✎
          </button>
          <button
            className="history-action"
            title={t("forkTitle")}
            onClick={() => {
              dispatch({ kind: "forkSession", id: session.id });
              setOpen(false);
            }}
          >
            ⧉
          </button>
          <button
            className="history-action"
            title={t("exportMdTitle")}
            onClick={() => {
              dispatch({ kind: "exportSession", id: session.id });
              setOpen(false);
            }}
          >
            ↧
          </button>
          <button
            className="history-action danger"
            title={t("deleteTitle")}
            onClick={() => {
              dispatch({ kind: "deleteSession", id: session.id });
              setOpen(false);
            }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="dropdown history" ref={rootRef}>
      <button className="icon-btn" onClick={openMenu} title={t("historyTitle")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="dropdown-menu history-menu">
          {!hasSessions ? (
            <div className="mention-empty">{t("noSessions")}</div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="dropdown-group">{group.label}</div>
                {group.sessions.map((fold) => (
                  <div key={fold.root.id}>
                    {renderRow(fold.root, fold)}
                    {(expanded.has(fold.root.id) || fold.root.id === forcedRoot) &&
                      fold.children.map((child) => renderRow(child, undefined, true))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
