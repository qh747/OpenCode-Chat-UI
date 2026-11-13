import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { ChipInput, ComposerHandle } from "./composerTypes";
import { BUILTIN_COMMANDS, filterCommands, mergeMentions, splitCommandInput } from "../src/util/commands";
import type { CommandInfoLike } from "../src/util/commands";
import type { CommandInfo, SkillInfo } from "../src/opencode/types";

const MAX_IMAGES = 6;

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  new: "新会话",
  undo: "撤销上一条消息",
  compact: "总结会话以减少上下文大小",
  fork: "从之前的消息创建新会话",
  export: "将完整会话记录导出为 Markdown",
};

interface ComposerProps {
  dispatch: Dispatch;
  busy: boolean;
  canSend: boolean;
  /** Mode/model/effort pickers rendered into the composer action bar. */
  pickers?: React.ReactNode;
  /** fileResults from the store, keyed by requestId. */
  fileResults: Record<string, { path: string; name: string }[]>;
  /** Slash commands from the server catalog. */
  commands: CommandInfo[];
  /** Skills from the server catalog. */
  skills: SkillInfo[];
  onRunCommand: (command: string, args: string) => void;
  onAbort: () => void;
  handleRef?: (handle: ComposerHandle) => void;
}

interface Chip extends ChipInput {
  key: string;
}

type ActiveList =
  | { kind: "commands"; index: number }
  | { kind: "mentions"; index: number }
  | undefined;

export function Composer({
  dispatch,
  busy,
  canSend,
  pickers,
  fileResults,
  commands,
  skills,
  onRunCommand,
  onAbort,
  handleRef,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [imageNotice, setImageNotice] = useState<string | undefined>();
  const [mentionSuppressed, setMentionSuppressed] = useState(false);
  const [active, setActive] = useState<ActiveList>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const counter = useRef(0);
  const mentionRequestId = useRef("");

  const commandMode = text.startsWith("/");
  const commandQuery = commandMode ? text.slice(1) : "";
  const commandList = (() => {
    const builtin = BUILTIN_COMMANDS.map((c) => ({ ...c, description: BUILTIN_DESCRIPTIONS[c.name] ?? "" }));
    const merged: CommandInfoLike[] = [...builtin];
    for (const c of commands) {
      if (!merged.some((m) => m.name === c.name)) {
        merged.push(c);
      }
    }
    return filterCommands(merged, commandQuery.replace(/\s+.*$/, ""));
  })();
  const mentionQuery = /@([^\s@]*)$/.exec(text)?.[1];
  const mentionOpen = !commandMode && !mentionSuppressed && mentionQuery !== undefined;
  const mentionList = mentionOpen
    ? mergeMentions(skills, fileResults[mentionRequestId.current] ?? [], mentionQuery ?? "")
    : [];

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
      setPromptText: (value) => {
        setText(value);
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

  // Keep an active row selected when the lists change.
  useEffect(() => {
    if (commandMode) {
      setActive({ kind: "commands", index: 0 });
    } else if (mentionOpen) {
      setActive({ kind: "mentions", index: 0 });
    } else {
      setActive(undefined);
    }
  }, [commandMode, mentionOpen, commandList.length, mentionList.length]);

  // Keyboard navigation must scroll the highlighted row into view.
  useEffect(() => {
    if (!active) {
      return;
    }
    listRef.current?.querySelector(".mention-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const requestMention = (query: string) => {
    const requestId = `mention-${counter.current++}`;
    mentionRequestId.current = requestId;
    dispatch({ kind: "searchFiles", requestId, query });
  };

  const handleChange = (value: string) => {
    setText(value);
    const mentionMatch = /@([^\s@]*)$/.exec(value);
    const query = mentionMatch?.[1];
    if (!value.startsWith("/") && query !== undefined) {
      setMentionSuppressed(false);
      requestMention(query);
    }
  };

  const acceptCommand = (name: string) => {
    setText(`/${name} `);
    textareaRef.current?.focus();
  };

  const acceptMention = (option: { kind: "skill" | "file"; value: string; label: string }) => {
    setText((current) => current.replace(/@([^\s@]*)$/, ""));
    if (option.kind === "skill") {
      setText((current) => `${current}@${option.label} `);
    } else {
      setChips((current) =>
        current.some((c) => c.path === option.value) ? current : [...current, { path: option.value, key: option.value }],
      );
    }
    textareaRef.current?.focus();
  };

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

  const acceptActive = () => {
    if (active?.kind === "commands") {
      const command = commandList[active.index];
      if (command) {
        acceptCommand(command.name);
      }
      return true;
    }
    if (active?.kind === "mentions") {
      const option = mentionList[active.index];
      if (option) {
        acceptMention(option);
      }
      return true;
    }
    return false;
  };

  const doSend = () => {
    const trimmed = text.trim();
    if (!trimmed || busy || !canSend) {
      return;
    }
    if (trimmed.startsWith("/")) {
      const { command, arguments: args } = splitCommandInput(trimmed);
      if (command) {
        onRunCommand(command, args);
        setText("");
        setActive(undefined);
        return;
      }
    }
    dispatch({ kind: "send", text: trimmed, files: chips.map((c) => c.path) });
    setText("");
    setChips([]);
    setActive(undefined);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (commandMode) {
        // With arguments typed ("/review hello") Enter executes directly;
        // bare "/name" accepts the highlighted suggestion into the input.
        if (text.includes(" ")) {
          const { command, arguments: args } = splitCommandInput(text);
          if (command) {
            onRunCommand(command, args);
            setText("");
            setActive(undefined);
          }
          return;
        }
        if (acceptActive()) {
          return;
        }
        const bare = splitCommandInput(text).command;
        if (bare) {
          onRunCommand(bare, "");
          setText("");
          setActive(undefined);
        }
        return;
      }
      if (mentionOpen && acceptActive()) {
        return;
      }
      doSend();
      return;
    }
    if (event.key === "ArrowDown" && active) {
      event.preventDefault();
      const length = active.kind === "commands" ? commandList.length : mentionList.length;
      setActive({ ...active, index: (active.index + 1) % Math.max(length, 1) });
      return;
    }
    if (event.key === "ArrowUp" && active) {
      event.preventDefault();
      const length = active.kind === "commands" ? commandList.length : mentionList.length;
      setActive({ ...active, index: (active.index - 1 + length) % Math.max(length, 1) });
      return;
    }
    if (event.key === "Tab" && (commandMode || mentionOpen)) {
      event.preventDefault();
      acceptActive();
      return;
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      dispatch({ kind: "cycleAgent", direction: 1 });
    }
    if (event.key === "Escape") {
      if (mentionOpen) {
        setMentionSuppressed(true);
      }
    }
  };

  const commandDescription = (name: string): string => {
    const builtin = BUILTIN_DESCRIPTIONS[name];
    if (builtin) {
      return builtin;
    }
    return commands.find((c) => c.name === name)?.description ?? "";
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
          placeholder="随便问点什么， / 可查看命令， @ 可添加上下文..."
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
            <button className="send-btn stop" onClick={onAbort} title="Stop the current turn">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={doSend}
              disabled={!text.trim() || !canSend}
              title="Send (Enter)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>
        {imageNotice && <div className="image-notice">{imageNotice}</div>}
        {commandMode && (
          <div className="mention-list" ref={listRef}>
            {commandList.length === 0 ? (
              <div className="mention-empty">No matching commands</div>
            ) : (
              commandList.map((command, index) => (
                <button
                  key={command.name}
                  className={`mention-item${active?.kind === "commands" && active.index === index ? " active" : ""}`}
                  onClick={() => acceptCommand(command.name)}
                >
                  <span className="mention-name">/{command.name}</span>
                  <span className="mention-desc">{commandDescription(command.name)}</span>
                </button>
              ))
            )}
          </div>
        )}
        {mentionOpen && (
          <div className="mention-list" ref={listRef}>
            {mentionList.length === 0 ? (
              <div className="mention-empty">No matching skills or files</div>
            ) : (
              mentionList.map((option, index) => (
                <button
                  key={`${option.kind}-${option.value}`}
                  className={`mention-item${active?.kind === "mentions" && active.index === index ? " active" : ""}`}
                  onClick={() => acceptMention(option)}
                >
                  <span className="mention-name">
                    {option.kind === "skill" ? `@${option.label}` : option.label}
                  </span>
                  <span className="mention-desc">{option.description}</span>
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
