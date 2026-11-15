import { useState } from "react";
import type { MessageInfo } from "../src/webview/protocol";
import { providerDisplayName } from "../src/util/commands";
import { lastBilledAssistant, totalTokens } from "../src/util/tokens";
import { t } from "../src/util/i18n";

export interface SessionInfoProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Active model's provider id (shown via providerDisplayName). */
  providerID?: string;
  /** Display name of the active model. */
  modelName?: string;
  contextLimit?: number;
  created?: number;
  updated?: number;
  cost?: number;
  /** Tokens of the latest billed assistant message (= 词元总数). */
  contextTokens?: number;
  messages: MessageInfo[];
  onExport: () => void;
}

/**
 * The session-info slide-over: the stat grid, the system prompt and the raw
 * message list, mirroring the opencode desktop "session info" view. All data
 * comes from frontend state — messages, the sessionMeta block and the catalog.
 */
export function SessionInfo({
  open,
  onClose,
  title,
  providerID,
  modelName,
  contextLimit,
  created,
  updated,
  cost,
  contextTokens,
  messages,
  onExport,
}: SessionInfoProps) {
  const [systemOpen, setSystemOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!open) {
    return null;
  }
  const last = lastBilledAssistant(messages);
  const tokens = last?.tokens;
  const total = contextTokens ?? (tokens ? totalTokens(tokens) : undefined);
  const count = (type: string) => messages.filter((m) => m.type === type).length;
  const system = findLastSystem(messages);
  return (
    <div className="session-info-overlay" onClick={onClose}>
      <div className="session-info" onClick={(event) => event.stopPropagation()}>
        <div className="session-info-head">
          <span className="session-info-title">{t("sessionInfoTitle")}</span>
          <span className="session-info-head-actions">
            <button className="btn small" onClick={onExport}>
              {t("exportSession")}
            </button>
            <button className="btn small" onClick={onClose} title={t("closeTitle")}>
              ✕
            </button>
          </span>
        </div>
        <div className="session-info-body">
          <div className="session-info-grid">
            <Cell label={t("statSession")} value={title} />
            <Cell label={t("statMessages")} value={messages.length ? messages.length.toLocaleString("en-US") : undefined} />
            <Cell
              label={t("statProvider")}
              value={providerID ? providerDisplayName(providerID) : undefined}
            />
            <Cell label={t("statModel")} value={modelName} />
            <Cell label={t("statContextLimit")} value={fmt(contextLimit)} />
            <Cell label={t("statTotalTokens")} value={fmt(total)} />
            <Cell
              label={t("statUsage")}
              value={
                total !== undefined && contextLimit
                  ? `${((total / contextLimit) * 100).toFixed(0)}%`
                  : undefined
              }
            />
            <Cell label={t("statInputTokens")} value={fmt(tokens?.input)} />
            <Cell label={t("statOutputTokens")} value={fmt(tokens?.output)} />
            <Cell label={t("statReasoningTokens")} value={fmt(tokens?.reasoning)} />
            <Cell
              label={t("statCacheTokens")}
              value={
                tokens ? `${fmt(tokens.cache?.read)} / ${fmt(tokens.cache?.write)}` : undefined
              }
            />
            <Cell label={t("statUserMessages")} value={fmt(count("user"))} />
            <Cell label={t("statAssistantMessages")} value={fmt(count("assistant"))} />
            <Cell label={t("statCost")} value={`US$${(cost ?? 0).toFixed(2)}`} />
            <Cell label={t("statCreated")} value={fmtTime(created)} />
            {/* 桌面端"最后活动"= 最后一条计费消息的时间，而非 session.time.updated */}
            <Cell label={t("statUpdated")} value={fmtTime(last?.time?.created ?? updated)} />
          </div>
          {system?.text && (
            <div className="session-info-section">
              <button
                className="session-info-toggle"
                onClick={() => setSystemOpen((value) => !value)}
              >
                <span aria-hidden="true">{systemOpen ? "▾" : "▸"}</span> {t("systemPrompt")}
              </button>
              {systemOpen && <pre className="session-info-pre">{system.text}</pre>}
            </div>
          )}
          <div className="session-info-section">
            <div className="session-info-section-head">{t("rawMessages")}</div>
            <div className="session-info-rows">
              {messages.map((message) => {
                const text = rawText(message);
                const open = expanded[message.id] ?? false;
                return (
                  <div key={message.id} className="session-info-row">
                    <button
                      className="session-info-row-head"
                      onClick={() =>
                        setExpanded((current) => ({ ...current, [message.id]: !open }))
                      }
                    >
                      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                      <span className="session-info-row-type">{message.type}</span>
                      <span className="session-info-row-id" title={message.id}>
                        {message.id}
                      </span>
                      <span className="session-info-row-time">{fmtTime(messageTime(message))}</span>
                    </button>
                    {open && <pre className="session-info-pre">{text || "—"}</pre>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="session-info-cell">
      <span className="session-info-label">{label}</span>
      <span className="session-info-value" title={value}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function fmt(value?: number): string | undefined {
  return value === undefined ? undefined : value.toLocaleString("en-US");
}

function fmtTime(ms?: number): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toLocaleString();
}

function messageTime(message: MessageInfo): number | undefined {
  const time = (message as { time?: { created?: number } }).time;
  return time?.created;
}

/**
 * The last system message's text, trimmed — the desktop shows the last one
 * (findLast) and trims it. Returns undefined when the session has none.
 */
function findLastSystem(messages: MessageInfo[]): (MessageInfo & { text?: string }) | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate?.type === "system") {
      const loose = candidate as MessageInfo & { text?: string };
      return { ...loose, text: typeof loose.text === "string" ? loose.text.trim() : undefined };
    }
  }
  return undefined;
}

/** The text the desktop shows for a raw message: its text field, or the text
 *  of its content parts for assistant replies that carry no top-level text. */
function rawText(message: MessageInfo): string {
  const loose = message as { text?: unknown; content?: { text?: unknown; type?: string }[] };
  if (typeof loose.text === "string" && loose.text) {
    return loose.text;
  }
  if (Array.isArray(loose.content)) {
    return loose.content
      .map((part) =>
        typeof part.text === "string" ? part.text : (part.type ?? ""),
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
