import { useEffect, useReducer, useRef } from "react";
import type { QueuedMessage } from "../src/webview/protocol";
import { t } from "../src/util/i18n";

interface QueueStripProps {
  queue: QueuedMessage[];
  paused: boolean;
  /** The open session; a change here must reset the strip to collapsed. */
  sessionID?: string;
  onForce: (id: string) => void;
  onRemove: (id: string) => void;
  onResume: () => void;
}

interface StripState {
  open: boolean;
}

type StripEvent =
  | { type: "queueChanged"; length: number; grew: boolean }
  | { type: "sessionChanged" }
  | { type: "toggle" };

/**
 * Pure strip expansion rules, extracted for tests:
 * - a new queued message auto-expands the strip (the user must see what the
 *   turn just picked up instead of a silent count bump);
 * - an emptied queue collapses it;
 * - switching sessions (or out to a subagent and back) collapses it again —
 *   the expansion belongs to the moment, not to the conversation.
 */
export function queueStripReducer(state: StripState, event: StripEvent): StripState {
  switch (event.type) {
    case "toggle":
      return { open: !state.open };
    case "sessionChanged":
      return { open: false };
    case "queueChanged":
      if (event.length === 0) {
        return { open: false };
      }
      // 新消息入队即展开；其余情况保持现状（含手动折叠）。
      return { open: event.grew ? true : state.open };
  }
}

/**
 * Messages sent while the model is working. Collapsed to a single header row by
 * default; expanding reveals the queued messages and their actions.
 */
export function QueueStrip({ queue, paused, sessionID, onForce, onRemove, onResume }: QueueStripProps) {
  const [state, dispatch] = useReducer(queueStripReducer, { open: false });
  const prevLength = useRef(0);
  const prevSession = useRef(sessionID);

  useEffect(() => {
    dispatch({ type: "queueChanged", length: queue.length, grew: queue.length > prevLength.current });
    prevLength.current = queue.length;
  }, [queue.length]);

  useEffect(() => {
    if (prevSession.current !== sessionID) {
      prevSession.current = sessionID;
      dispatch({ type: "sessionChanged" });
    }
  }, [sessionID]);

  const open = state.open && queue.length > 0;

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className={`queue-strip${open ? " open" : ""}`}>
      <div className="queue-head">
        <button
          className="queue-toggle"
          onClick={() => dispatch({ type: "toggle" })}
          aria-expanded={open}
          title={open ? t("queueCollapse") : t("queueExpand")}
        >
          <span className="queue-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="queue-count">{t("queueCount", { count: queue.length })}</span>
          <span className={`queue-note${paused ? " paused" : ""}`}>
            {paused ? t("queuePausedNote") : t("queueAutoNote")}
          </span>
        </button>
        <span className="spacer" />
        {paused && (
          <button className="queue-head-btn" onClick={onResume}>
            {t("resume")}
          </button>
        )}
      </div>
      {open &&
        queue.map((item, index) => (
          <div className="queue-row" key={item.id}>
            <span className="queue-index">{index + 1}</span>
            <span className="queue-text" title={item.text}>
              {item.text}
            </span>
            <button
              className="queue-force"
              onClick={() => onForce(item.id)}
              title={t("sendNow")}
              aria-label={t("sendNow")}
            >
              ↑
            </button>
            <button
              className="queue-remove"
              onClick={() => onRemove(item.id)}
              title={t("removeFromQueue")}
            >
              ×
            </button>
          </div>
        ))}
    </div>
  );
}
