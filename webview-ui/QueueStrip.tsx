import { useEffect, useState } from "react";
import type { QueuedMessage } from "../src/webview/protocol";
import { t } from "../src/util/i18n";

interface QueueStripProps {
  queue: QueuedMessage[];
  paused: boolean;
  onForce: (id: string) => void;
  onRemove: (id: string) => void;
  onResume: () => void;
}

/**
 * Messages sent while the model is working. Collapsed to a single header row by
 * default; expanding reveals the queued messages and their actions.
 */
export function QueueStrip({ queue, paused, onForce, onRemove, onResume }: QueueStripProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (queue.length === 0) {
      setOpen(false);
    }
  }, [queue.length]);

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className={`queue-strip${open ? " open" : ""}`}>
      <div className="queue-head">
        <button
          className="queue-toggle"
          onClick={() => setOpen((value) => !value)}
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
              title={t("queueTitleBusy")}
            >
              {t("sendNow")}
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
