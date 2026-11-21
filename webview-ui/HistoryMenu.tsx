import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { HistoryGroup } from "../src/webview/protocol";
import { relativeSessionTime, displaySessionTitle } from "../src/util/sessions";
import type { HistoryRow } from "../src/util/sessions";
import { t } from "../src/util/i18n";

interface HistoryMenuProps {
  dispatch: Dispatch;
  groups: HistoryGroup[];
  /**
   * The row to highlight. The app passes the on-screen session's id, or its
   * parent's id while a child session is on screen (spec D3) — the menu lists
   * root sessions only, so a deeper chain simply highlights nothing.
   */
  currentSessionId?: string;
  /** Called once when the menu opens so the host can fetch fresh sessions. */
  onOpen: () => void;
  /** 测试开口：初始即展开弹层（生产代码不传，等同 false）。 */
  initialOpen?: boolean;
}

/**
 * Clock button + in-webview history menu anchored to the header button.
 * 只列根会话（spec D1）：subagent 会话彻底不出现，委托活动的信号在
 * 聊天流的 SubagentStrip 上。行颜色只由该会话自身状态决定（ADR-0016）。
 */
export function HistoryMenu({ dispatch, groups, currentSessionId, onOpen, initialOpen }: HistoryMenuProps) {
  const [open, setOpen] = useState(initialOpen ?? false);
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

  const switchTo = (id: string) => {
    dispatch({ kind: "switchSession", id });
    setOpen(false);
  };

  const hasSessions = groups.some((group) => group.sessions.length > 0);

  const renderRow = (session: HistoryRow) => {
    return (
      <div className="history-row-wrap" key={session.id}>
        <button
          className={`history-row${session.id === currentSessionId ? " is-current" : ""}`}
          onClick={() => switchTo(session.id)}
          title={displaySessionTitle(session.title, t("untitled"))}
        >
          {/* 状态直接用标题颜色表达，不再渲染独立圆点（spec 分支 1）；
              行状态就是该会话自身的状态（ADR-0016），不聚合子代理。
              服务器自动标题本地化（spec Q11a）：命中显示 t("newSession")，
              原始 ISO 串不在文本与 tooltip 露出。 */}
          <span className={`history-title status-${session.status}`}>
            {displaySessionTitle(session.title, t("untitled"))}
          </span>
          {/* 时间列读创建时间（spec Q7）：与行序（created 倒序）自洽，
              活动不改变行位也不改变这一列。 */}
          <span className="history-time">{relativeSessionTime(session.created)}</span>
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
                {group.sessions.map(renderRow)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
