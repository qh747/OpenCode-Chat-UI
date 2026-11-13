import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { ChipInput, ComposerHandle } from "./composerTypes";

const MAX_IMAGES = 6;

interface ComposerProps {
  dispatch: Dispatch;
  busy: boolean;
  canSend: boolean;
  /** Mode/model/effort pickers rendered into the composer action bar. */
  pickers?: React.ReactNode;
  /** fileResults from the store, keyed by requestId. */
  fileResults: Record<string, { path: string; name: string }[]>;
  onAbort: () => void;
  handleRef?: (handle: ComposerHandle) => void;
}

interface Chip extends ChipInput {
  key: string;
}

export function Composer({ dispatch, busy, canSend, pickers, fileResults, onAbort, handleRef }: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [imageNotice, setImageNotice] = useState<string | undefined>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState<{ path: string; name: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const counter = useRef(0);
  const mentionRequestId = useRef("");

  useEffect(() => {
    handleRef?.({
      setChips: (items) => {
        setChips((current) => {
          const known = new Set(current.map((c) => c.path));
          const additions = items
            .filter((item) => !known.has(item.path))
            .map((item) => ({ ...item, key: `${item.path}-${Date.now()}-${Math.random()}` }));
          return [...current, ...additions];
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
      current.some((c) => c.path === result.path) ? current : [...current, { ...result, key: result.path }],
    );
    textareaRef.current?.focus();
  };

  /** Read an image File and ask the host to stage it as an attachable temp file. */
  const stageImageFile = (file: File) => {
    const imageChips = chips.filter((c) => c.image).length;
    if (imageChips >= MAX_IMAGES) {
      setImageNotice(`Maximum ${MAX_IMAGES} images per message.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const requestId = `img-${counter.current++}`;
      dispatch({
        kind: "stageImage",
        requestId,
        name: file.name || `pasted-image.${file.type.split("/")[1] ?? "png"}`,
        dataBase64: base64,
      });
    };
    reader.readAsDataURL(file);
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of event.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          stageImageFile(file);
        }
      }
    }
  };

  const onDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    for (const file of event.dataTransfer.files) {
      if (file.type.startsWith("image/")) {
        event.preventDefault();
        stageImageFile(file);
      }
    }
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
    setImageNotice(undefined);
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
            <span key={chip.key} className="chip" title={chip.path}>
              {chip.image ? "🖼" : "📄"} {chip.name ?? fileName(chip.path)}
              <button
                className="chip-remove"
                onClick={() => setChips((current) => current.filter((c) => c.key !== chip.key))}
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
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder="Build anything…  (@ files, paste images)"
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
          {pickers}
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
        {imageNotice && <div className="image-notice">{imageNotice}</div>}
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
