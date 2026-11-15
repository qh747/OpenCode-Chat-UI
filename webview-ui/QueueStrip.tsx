import { useEffect, useState } from "react";
import type { QueuedMessage } from "../src/webview/protocol";

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
          title={open ? "收起队列" : "展开队列"}
        >
          <span className="queue-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="queue-count">QUEUE {queue.length}</span>
          <span className={`queue-note${paused ? " paused" : ""}`}>
            {paused ? "已暂停 · 继续后自动发送" : "turn 结束后自动发送"}
          </span>
        </button>
        <span className="spacer" />
        {paused && (
          <button className="queue-head-btn" onClick={onResume}>
            继续
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
              title="中断当前 turn 并立即发送"
            >
              立即发送
            </button>
            <button
              className="queue-remove"
              onClick={() => onRemove(item.id)}
              title="从队列中删除"
            >
              ×
            </button>
          </div>
        ))}
    </div>
  );
}
