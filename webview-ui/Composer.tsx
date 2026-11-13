import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { ComposerHandle } from "./composerTypes";

interface ComposerProps {
  dispatch: Dispatch;
  busy: boolean;
  canSend: boolean;
  agent: string | undefined;
  /** fileResults from the store, keyed by requestId. */
  fileResults: Record<string, { path: string; name: string }[]>;
  onAbort: () => void;
  handleRef?: (handle: ComposerHandle) => void;
}

interface Chip {
  path: string;
}

export function Composer({ dispatch, busy, canSend, agent, fileResults, onAbort, handleRef }: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const counter = useRef(0);
  const mentionRequestId = useRef("");

  useEffect(() => {
    handleRef?.({
      setChips: (paths) => {
        setChips((current) => {
          const known = new Set(current.map((c) => c.path));
          return [...current, ...paths.filter((p) => !known.has(p)).map((p) => ({ path: p }))];
        });
        textareaRef.current?.focus();
      },
    });
  }, [handleRef]);

  // Auto-resize the textarea with content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Pull mention search results from the shared store.
  useEffect(() => {
    if (!mentionOpen) {
      return;
    }
    const results = fileResults[mentionRequestId.current];
    if (results) {
      setMentionResults(results);
    }
  }, [fileResults, mentionOpen]);

  const requestMention = (query: string) => {
    const requestId = `mention-${counter.current++}`;
    mentionRequestId.current = requestId;
    setMentionResults([]);
    dispatch({ kind: "searchFiles", requestId, query });
  };

  const handleChange = (value: string) => {
    setText(value);
    const mentionMatch = /@([^\s@]*)$/.exec(value);
    const query = mentionMatch?.[1];
    if (query !== undefined) {
      setMentionOpen(true);
      requestMention(query);
    } else {
      setMentionOpen(false);
    }
  };

  const acceptMention = (result: { path: string; name: string }) => {
    setText((current) => current.replace(/@([^\s@]*)$/, ""));
    setMentionOpen(false);
    setChips((current) =>
      current.some((c) => c.path === result.path) ? current : [...current, { path: result.path }],
    );
    textareaRef.current?.focus();
  };

  const doSend = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }
    dispatch({ kind: "send", text: trimmed, files: chips.map((c) => c.path) });
    setText("");
    setChips([]);
    setMentionOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      doSend();
      return;
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      dispatch({ kind: "cycleAgent", direction: 1 });
    }
    if (event.key === "Escape" && mentionOpen) {
      setMentionOpen(false);
    }
  };

  return (
    <div className="composer">
      {chips.length > 0 && (
        <div className="chips-row">
          {chips.map((chip) => (
            <span key={chip.path} className="chip" title={chip.path}>
              📄 {fileName(chip.path)}
              <button
                className="chip-remove"
                onClick={() => setChips((current) => current.filter((c) => c.path !== chip.path))}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Build anything…  (@ to attach files)"
          rows={1}
          disabled={!canSend}
        />
        <div className="composer-actions">
          <button
            className="icon-btn"
            onClick={() => dispatch({ kind: "pickFiles", requestId: `pick-${counter.current++}` })}
            title="Attach files"
          >
            +
          </button>
          {agent && (
            <span className="agent-indicator" title="Agent (Shift+Tab to cycle)">
              {agent}
            </span>
          )}
          <span className="spacer" />
          {busy ? (
            <button className="btn danger" onClick={onAbort} title="Stop the current turn">
              ■ Stop
            </button>
          ) : (
            <button className="btn primary" onClick={doSend} disabled={!text.trim() || !canSend}>
              Send ⏎
            </button>
          )}
        </div>
        {mentionOpen && (
          <div className="mention-list">
            {mentionResults.length === 0 ? (
              <div className="mention-empty">No matching files</div>
            ) : (
              mentionResults.map((result) => (
                <button key={result.path} className="mention-item" onClick={() => acceptMention(result)}>
                  📄 {result.name}
                  <span className="mention-path">{result.path}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function fileName(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}
