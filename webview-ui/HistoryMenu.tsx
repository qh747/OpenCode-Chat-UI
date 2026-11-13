import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { HistoryGroup } from "../src/webview/protocol";
import { relativeSessionTime } from "../src/util/sessions";

interface HistoryMenuProps {
  dispatch: Dispatch;
  groups: HistoryGroup[];
  /** Called once when the menu opens so the host can fetch fresh sessions. */
  onOpen: () => void;
}

/** Clock button + in-webview history menu anchored to the header button. */
export function HistoryMenu({ dispatch, groups, onOpen }: HistoryMenuProps) {
  const [open, setOpen] = useState(false);
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

  const hasSessions = groups.some((g) => g.sessions.length > 0);

  return (
    <div className="dropdown history" ref={rootRef}>
      <button className="icon-btn" onClick={openMenu} title="Session history">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="dropdown-menu history-menu">
          {!hasSessions ? (
            <div className="mention-empty">No sessions yet</div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="dropdown-group">{group.label}</div>
                {group.sessions.map((session) => (
                  <div key={session.id} className="history-row-wrap">
                    <button
                      className="history-row"
                      onClick={() => {
                        dispatch({ kind: "switchSession", id: session.id });
                        setOpen(false);
                      }}
                      title={session.title}
                    >
                      <span className="history-title">{session.title || "Untitled"}</span>
                      <span className="history-time">{relativeSessionTime(session.updated)}</span>
                    </button>
                    <div className="history-actions">
                      <button
                        className="history-action"
                        title="Rename"
                        onClick={() => {
                          dispatch({ kind: "renameSession", id: session.id, currentTitle: session.title });
                          setOpen(false);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="history-action"
                        title="Fork"
                        onClick={() => {
                          dispatch({ kind: "forkSession", id: session.id });
                          setOpen(false);
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        className="history-action"
                        title="Export as Markdown"
                        onClick={() => {
                          dispatch({ kind: "exportSession", id: session.id });
                          setOpen(false);
                        }}
                      >
                        ↧
                      </button>
                      <button
                        className="history-action danger"
                        title="Delete"
                        onClick={() => {
                          dispatch({ kind: "deleteSession", id: session.id });
                          setOpen(false);
                        }}
                      >
                        ✕
                      </button>
                    </div>
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
