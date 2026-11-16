import { useEffect, useState, type ReactNode } from "react";
import { Markdown } from "./Markdown";
import type {
  AssistantContent,
  AssistantMessage,
  MessageInfo,
  ToolState,
  UserMessage,
} from "../src/opencode/types";
import {
  attachmentTarget,
  describeAttachments,
  extractLinks,
  type AttachmentItem,
} from "../src/util/message-attachments";
import { stripTrailingMarkers } from "../src/util/dcp-markers";
import { t, type MessageKey } from "../src/util/i18n";

/** How a tool call reads in the transcript. */
const TOOL_VERBS: Record<string, MessageKey> = {
  bash: "toolVerb.bash",
  read: "toolVerb.read",
  write: "toolVerb.write",
  edit: "toolVerb.edit",
  patch: "toolVerb.edit",
  grep: "toolVerb.grep",
  glob: "toolVerb.grep",
  list: "toolVerb.list",
  webfetch: "toolVerb.webfetch",
  task: "toolVerb.task",
  todowrite: "toolVerb.todos",
  todoread: "toolVerb.todos",
};

function toolVerb(name: string): string {
  const key = TOOL_VERBS[name.toLowerCase()];
  return key ? t(key) : name;
}

function toolTarget(state: ToolState): string {
  const input = state.input as Record<string, unknown>;
  const candidates = ["file_path", "path", "command", "description", "pattern", "query", "url"];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value) {
      return value.length > 120 ? `${value.slice(0, 120)}…` : value;
    }
  }
  return "";
}

function StrokeIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function toolIcon(name: string): ReactNode {
  switch (name.toLowerCase()) {
    case "read":
      return (
        <StrokeIcon>
          <path d="M6.25 3.75h7.5l4 4v12.5h-11.5z" />
          <path d="M13.5 3.75v4.25h4.25" />
        </StrokeIcon>
      );
    case "write":
    case "edit":
    case "patch":
      return (
        <StrokeIcon>
          <path d="M6.25 3.75h7.5l4 4v12.5h-11.5z" />
          <path d="M13.5 3.75v4.25h4.25" />
          <path d="M9.25 14.5h5" />
        </StrokeIcon>
      );
    case "grep":
    case "glob":
    case "list":
      return (
        <StrokeIcon>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </StrokeIcon>
      );
    default:
      return (
        <StrokeIcon>
          <rect x="2.75" y="4.25" width="18.5" height="15.5" rx="2.5" />
          <path d="M6.5 9.5 8.9 12l-2.4 2.5" />
          <path d="M12.5 14.5h4.5" />
        </StrokeIcon>
      );
  }
}

const THOUGHT_ICON = (
  <StrokeIcon>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
  </StrokeIcon>
);

function ToolRow({ part }: { part: Extract<AssistantContent, { type: "tool" }> }) {
  const state = part.state;
  const output =
    state.status === "completed"
      ? state.content
          .map((chunk) => chunk.text ?? "")
          .join("\n")
          .trim()
      : "";
  const error = state.status === "error" ? (state.error?.message ?? "").trim() : "";
  const body = error || output;
  const target = toolTarget(state);
  return (
    <details className={`tool-row tool-row-${state.status}`}>
      <summary className="tool-row-head">
        <span className="tool-row-icon">{toolIcon(part.name)}</span>
        <span className="tool-row-label">{toolVerb(part.name)}</span>
        {target && <span className="tool-row-target">{target}</span>}
        {body && <span className="tool-row-chev">›</span>}
      </summary>
      {body && (
        <div className="tool-row-body">
          <pre className={`tool-row-pre${error ? " tool-row-pre-error" : ""}`}>{body}</pre>
        </div>
      )}
    </details>
  );
}

function ThinkingRow({ part }: { part: Extract<AssistantContent, { type: "reasoning" }> }) {
  const created = part.time?.created;
  const completed = part.time?.completed;
  const seconds =
    typeof created === "number" && typeof completed === "number"
      ? Math.max(1, Math.round((completed - created) / 1000))
      : undefined;
  const label = seconds ? t("thoughtFor", { count: seconds }) : t("thinking");
  return (
    <details className="tool-row tool-row-thinking">
      <summary className="tool-row-head">
        <span className="tool-row-icon">{THOUGHT_ICON}</span>
        <span className="tool-row-label">{label}</span>
        <span className="tool-row-chev">›</span>
      </summary>
      <div className="tool-row-body">
        <Markdown text={stripTrailingMarkers(part.text)} className="thinking-body" />
      </div>
    </details>
  );
}

interface AssistantProps {
  message: MessageInfo;
  streaming: boolean;
  onOpenUrl: (url: string) => void;
  onCopyCode: (text: string) => void;
}

function AssistantMessage({ message, streaming, onOpenUrl, onCopyCode }: AssistantProps) {
  if (message.type !== "assistant") {
    return null;
  }
  const assistant = message as AssistantMessage;
  // React keys and streaming state follow the part's position among its own
  // kind: a tool call inserted between two text parts must not remount them.
  const ordinals = assistant.content.map(
    (part, index) =>
      assistant.content.slice(0, index).filter((other) => other.type === part.type).length,
  );
  return (
    <div className="msg assistant">
      {assistant.agent && (
        <div className="msg-meta">
          <span className="agent-badge">{assistant.agent}</span>
        </div>
      )}
      {assistant.content.map((part, index) => {
        if (part.type === "text") {
          const text = stripTrailingMarkers(part.text);
          if (!text) {
            return null;
          }
          const isLast = index === assistant.content.length - 1;
          return (
            <Markdown
              key={`${assistant.id}:text:${ordinals[index]}`}
              text={text}
              className={isLast && streaming ? "streaming" : ""}
              onOpenUrl={onOpenUrl}
              onCopyCode={onCopyCode}
            />
          );
        }
        if (part.type === "reasoning") {
          return <ThinkingRow key={`${assistant.id}:reasoning:${ordinals[index]}`} part={part} />;
        }
        return <ToolRow key={part.id} part={part} />;
      })}
      {assistant.error?.message && <div className="msg-error">⚠ {assistant.error.message}</div>}
    </div>
  );
}

function AttachmentIcon({ kind }: { kind: AttachmentItem["kind"] }) {
  switch (kind) {
    case "image":
      return (
        <StrokeIcon>
          <rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4.5 17.5 10 12l4 3.8 2.8-2.3 3.4 3" />
        </StrokeIcon>
      );
    case "selection":
      return (
        <StrokeIcon>
          <path d="M4.5 8V5.5a1 1 0 0 1 1-1H8M16 4.5h2.5a1 1 0 0 1 1 1V8M19.5 16v2.5a1 1 0 0 1-1 1H16M8 19.5H5.5a1 1 0 0 1-1-1V16" />
          <path d="M8.5 12h7" />
        </StrokeIcon>
      );
    case "url":
      return (
        <StrokeIcon>
          <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11.5 7.5" />
          <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l1.5-1.5" />
        </StrokeIcon>
      );
    default:
      return (
        <StrokeIcon>
          <path d="M6.25 3.75h7.5l4 4v12.5h-11.5z" />
          <path d="M13.5 3.75v4.25h4.25" />
        </StrokeIcon>
      );
  }
}

/**
 * The attachments of a user message, collapsed into one summary line. The
 * line names what was attached and expands into a row per attachment; a
 * link is a row of its own, no longer a bare line inside the text.
 */
function AttachmentGroup({
  items,
  onOpenFile,
  onOpenUrl,
  onPreviewImage,
}: {
  items: AttachmentItem[];
  onOpenFile: (path: string, start?: number, end?: number) => void;
  onOpenUrl: (url: string) => void;
  onPreviewImage: (item: AttachmentItem) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  const names = items.map((item) => item.name).join(" · ");
  return (
    <details className="attach-group">
      <summary className="attach-bar">
        <span className="attach-thumbs">
          {items
            .filter((item) => item.image)
            .slice(0, 3)
            .map((item) => (
              <img key={item.name} className="attach-thumb" src={item.image} alt="" />
            ))}
        </span>
        <span className="attach-count">{t("attachmentsCount", { count: items.length })}</span>
        <span className="attach-names">{names}</span>
        <span className="attach-chev">›</span>
      </summary>
      <div className="attach-list">
        {items.map((item, index) => (
          <button
            key={index}
            className="attach-item"
            onClick={() => {
              const target = attachmentTarget(item);
              if (!target) {
                return;
              }
              if (target.kind === "preview") {
                onPreviewImage(target.item);
                return;
              }
              if (target.kind === "url") {
                onOpenUrl(target.url);
                return;
              }
              onOpenFile(target.path, target.start, target.end);
            }}
            title={item.detail ?? item.name}
          >
            <span className="attach-icon">
              {item.image ? (
                <img src={item.image} alt="" />
              ) : (
                <AttachmentIcon kind={item.kind} />
              )}
            </span>
            <span className="attach-name">{item.name}</span>
            <span className="attach-detail">{item.detail}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

/** A pasted image, shown full size over the transcript. */
function ImagePreview({ item, onClose }: { item: AttachmentItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-card" onClick={(event) => event.stopPropagation()}>
        <div className="preview-head">
          <span className="type t-image">IMG</span>
          <span className="preview-name">{item.name}</span>
          <span className="preview-sub">{item.mime}</span>
          <span className="spacer" />
          <button className="preview-close" onClick={onClose} title={t("closePreview")}>
            ×
          </button>
        </div>
        <div className="preview-body">
          <img className="preview-image" src={item.image} alt={item.name} />
        </div>
      </div>
    </div>
  );
}

interface UserProps {
  message: MessageInfo;
  onRewind: (messageID: string) => void;
  onOpenFile: (path: string, start?: number, end?: number) => void;
  onOpenUrl: (url: string) => void;
  onCopyCode: (text: string) => void;
  onPreviewImage: (item: AttachmentItem) => void;
}

function UserMessage({
  message,
  onRewind,
  onOpenFile,
  onOpenUrl,
  onCopyCode,
  onPreviewImage,
}: UserProps) {
  if (message.type !== "user") {
    return null;
  }
  const user = message as UserMessage;
  // Links travel inside the message text; the host marks them so they can be
  // pulled back out and shown as attachments of their own.
  const { body, links } = extractLinks(user.text);
  const items = describeAttachments(user.files, links);
  return (
    <div className="msg-group">
      <div className="msg user">
        <Markdown
          text={body}
          className="user-text"
          onOpenUrl={onOpenUrl}
          onCopyCode={onCopyCode}
        />
        <button
          className="rewind-btn"
          onClick={() => onRewind(user.id)}
          title={t("rewindTitle")}
        >
          ⏪
        </button>
      </div>
      <AttachmentGroup
        items={items}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
        onPreviewImage={onPreviewImage}
      />
    </div>
  );
}

export function ConversationErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className="conversation-errors">
      {errors.map((error, index) => (
        <div key={index} className="msg-failure">
          {error}
        </div>
      ))}
    </div>
  );
}

interface Props {
  messages: MessageInfo[];
  busy: boolean;
  onRewind: (messageID: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenFile: (path: string, start?: number, end?: number) => void;
  onCopyCode: (text: string) => void;
}

export function MessageList({
  messages,
  busy,
  onRewind,
  onOpenUrl,
  onOpenFile,
  onCopyCode,
}: Props) {
  const [preview, setPreview] = useState<AttachmentItem | undefined>(undefined);
  const visible = messages.filter((m) => m.type === "user" || m.type === "assistant");
  return (
    <>
      <div className="message-list" id="message-list">
        {visible.map((message) =>
          message.type === "user" ? (
            <UserMessage
              key={message.id}
              message={message}
              onRewind={onRewind}
              onOpenFile={onOpenFile}
              onOpenUrl={onOpenUrl}
              onCopyCode={onCopyCode}
              onPreviewImage={setPreview}
            />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              streaming={
                busy && message.type === "assistant" && !(message as AssistantMessage).finish
              }
              onOpenUrl={onOpenUrl}
              onCopyCode={onCopyCode}
            />
          ),
        )}
        {busy && (
          <div className="typing">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
      </div>
      {preview && <ImagePreview item={preview} onClose={() => setPreview(undefined)} />}
    </>
  );
}
