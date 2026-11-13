import { useState } from "react";
import { Markdown } from "./Markdown";
import type {
  AssistantContent,
  AssistantMessage,
  MessageInfo,
  ToolState,
  UserMessage,
} from "../src/opencode/types";

const TOOL_LABELS: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Patch",
  glob: "Glob",
  grep: "Grep",
  list: "List",
  todowrite: "Todos",
  todoread: "Todos",
  webfetch: "Fetch",
  task: "Task",
  agents: "Agents",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name.toLowerCase()] ?? name;
}

function toolSummary(state: ToolState): string {
  const input = state.input as Record<string, unknown>;
  const candidates = ["file_path", "path", "command", "description", "pattern", "query", "url"];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value;
    }
  }
  return "";
}

function ToolCard({ part }: { part: Extract<AssistantContent, { type: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const statusIcon =
    part.state.status === "completed"
      ? "✓"
      : part.state.status === "error"
        ? "✗"
        : part.state.status === "running"
          ? "⟳"
          : "…";
  const summary = toolSummary(part.state);
  const output =
    part.state.status === "completed"
      ? part.state.content.map((c) => c.text ?? "").join("\n").trim()
      : "";
  const inputText = JSON.stringify(part.state.input, null, 2);
  const hasBody = output.length > 0 || Object.keys(part.state.input ?? {}).length > 0;

  return (
    <div className={`tool-card tool-${part.state.status}`}>
      <button className="tool-header" onClick={() => hasBody && setOpen(!open)} disabled={!hasBody}>
        <span className={`tool-status status-${part.state.status}`}>{statusIcon}</span>
        <span className="tool-name">{toolLabel(part.name)}</span>
        <span className="tool-summary">{summary}</span>
      </button>
      {open && (
        <div className="tool-body">
          {Object.keys(part.state.input ?? {}).length > 0 && (
            <pre className="tool-input">{inputText}</pre>
          )}
          {output && <pre className="tool-output">{output}</pre>}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ message, streaming }: { message: MessageInfo; streaming: boolean }) {
  if (message.type !== "assistant") {
    return null;
  }
  const assistant = message as AssistantMessage;
  const showHeader = assistant.agent || assistant.model;
  return (
    <div className="msg assistant">
      {showHeader && (
        <div className="msg-meta">
          {assistant.agent && <span className="agent-badge">{assistant.agent}</span>}
        </div>
      )}
      {assistant.content.map((part, index) => {
        if (part.type === "text") {
          if (!part.text) {
            return null;
          }
          const isLast = index === assistant.content.length - 1;
          return (
            <Markdown key={index} text={part.text} className={isLast && streaming ? "streaming" : ""} />
          );
        }
        if (part.type === "reasoning") {
          return <ReasoningBlock key={index} text={part.text} />;
        }
        return <ToolCard key={part.id} part={part} />;
      })}
      {assistant.error?.message && <div className="msg-error">⚠ {assistant.error.message}</div>}
      {typeof assistant.cost === "number" && assistant.cost > 0 && (
        <div className="msg-cost">${assistant.cost.toFixed(4)}</div>
      )}
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) {
    return null;
  }
  return (
    <div className="reasoning">
      <button className="reasoning-header" onClick={() => setOpen(!open)}>
        <span>{open ? "▾" : "▸"}</span> Thinking
      </button>
      {open && <Markdown text={text} className="reasoning-body" />}
    </div>
  );
}

function UserMessage({ message, onRewind }: { message: MessageInfo; onRewind: (messageID: string) => void }) {
  if (message.type !== "user") {
    return null;
  }
  const user = message as UserMessage;
  return (
    <div className="msg user">
      <Markdown text={user.text} className="user-text" />
      {(user.files ?? []).map((file, index) => (
        <span key={index} className="chip chip-file">
          📄 {file.name ?? file.source?.type}
        </span>
      ))}
      <button
        className="rewind-btn"
        onClick={() => onRewind(user.id)}
        title="Rewind to before this message (removes later messages, reverts their file changes)"
      >
        ⏪
      </button>
    </div>
  );
}

interface Props {
  messages: MessageInfo[];
  busy: boolean;
  onRewind: (messageID: string) => void;
}

export function MessageList({ messages, busy, onRewind }: Props) {
  const visible = messages.filter(
    (m) => m.type === "user" || m.type === "assistant",
  );
  return (
    <div className="message-list" id="message-list">
      {visible.map((message) =>
        message.type === "user" ? (
          <UserMessage key={message.id} message={message} onRewind={onRewind} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            streaming={
              busy && message.type === "assistant" && !(message as AssistantMessage).finish
            }
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
  );
}
