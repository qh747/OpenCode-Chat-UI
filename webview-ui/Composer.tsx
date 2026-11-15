import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { ChipInput, ComposerHandle } from "./composerTypes";
import { ContextBar } from "./ContextBar";
import type { ContextBarProps } from "./ContextBar";
import { BUILTIN_COMMANDS, filterCommands, mergeMentions, splitCommandInput } from "../src/util/commands";
import type { CommandInfoLike, MentionOption } from "../src/util/commands";
import type { CommandInfo, SkillInfo } from "../src/opencode/types";
import type { AttachmentKind, AttachmentPreview, EditorFile } from "../src/webview/protocol";

const MAX_IMAGES = 6;

const KIND_LABEL: Record<AttachmentKind, string> = {
  image: "IMG",
  file: "FILE",
  selection: "SEL",
  url: "URL",
};

const KIND_WORD: Record<AttachmentKind, string> = {
  image: "图片",
  file: "文件",
  selection: "选区",
  url: "链接",
};

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
  /** Open editor tabs and their live selections. */
  editors: EditorFile[];
  /** Attachment previews answered by the host, keyed by requestId. */
  previews: Record<string, AttachmentPreview>;
  onRunCommand: (command: string, args: string) => void;
  onAbort: () => void;
  handleRef?: (handle: ComposerHandle) => void;
  /** Context strip rendered under the input box. */
  context?: ContextBarProps;
}

interface Chip extends ChipInput {
  key: string;
  kind: AttachmentKind;
}

type ActiveList =
  | { kind: "commands"; index: number }
  | { kind: "mentions"; index: number }
  | undefined;

/** One row of the `@` popover: an editor selection, an open file, or a search hit. */
interface MentionRow {
  group: "selected" | "open" | "other";
  key: string;
  name: string;
  description?: string;
  path?: string;
  range?: { start: number; end: number };
  option?: MentionOption;
}

interface PreviewState {
  name: string;
  kind: AttachmentKind;
  requestId?: string;
  url?: string;
}

export function Composer({
  dispatch,
  busy,
  canSend,
  pickers,
  fileResults,
  commands,
  skills,
  editors,
  previews,
  onRunCommand,
  onAbort,
  handleRef,
  context,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [imageNotice, setImageNotice] = useState<string | undefined>();
  const [mentionSuppressed, setMentionSuppressed] = useState(false);
  const [active, setActive] = useState<ActiveList>(undefined);
  const [preview, setPreview] = useState<PreviewState | null>(null);
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

  const mentionRows = useMemo<MentionRow[]>(() => {
    if (!mentionOpen) {
      return [];
    }
    const query = (mentionQuery ?? "").toLowerCase();
    const matches = (name: string) => !query || name.toLowerCase().includes(query);
    const selected: MentionRow[] = editors
      .filter((editor) => editor.selected && matches(editor.name))
      .map((editor) => ({
        group: "selected" as const,
        key: `sel-${editor.path}`,
        name: editor.name,
        path: editor.path,
        range: editor.selected,
        description: `L${editor.selected?.start}-${editor.selected?.end} · 选中`,
      }));
    // Open but unselected files are suggestions, never citable ranges.
    const open: MentionRow[] = editors
      .filter((editor) => !editor.selected && matches(editor.name))
      .map((editor) => ({
        group: "open" as const,
        key: `open-${editor.path}`,
        name: editor.name,
        path: editor.path,
        description: "已打开 · 无选区",
      }));
    const other: MentionRow[] = mergeMentions(
      skills,
      fileResults[mentionRequestId.current] ?? [],
      mentionQuery ?? "",
    ).map((option) => ({
      group: "other" as const,
      key: `${option.kind}-${option.value}`,
      name: option.kind === "skill" ? `@${option.label}` : option.label,
      description: option.description,
      option,
    }));
    return [...selected, ...open, ...other];
  }, [mentionOpen, mentionQuery, editors, skills, fileResults]);

  useEffect(() => {
    handleRef?.({
      setChips: (items) => {
        setChips((current) => {
          const known = new Set(current.map((c) => c.path));
          const additions = items
            .filter((item) => !known.has(item.path))
            .map((item) => ({
              ...item,
              kind: item.kind ?? "file",
              key: `${item.path}-${Date.now()}-${Math.random()}`,
            }));
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
    const max = 200;
    el.style.height = "auto";
    let next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    // scrollHeight ignores some of the padding, so the first guess can be a few
    // pixels short — that overflow is what makes Chromium draw a scrollbar.
    if (el.scrollHeight > el.clientHeight) {
      next = Math.min(next + (el.scrollHeight - el.clientHeight), max);
      el.style.height = `${next}px`;
    }
  }, [text]);

  // Escape closes the preview even when focus sits on a token.
  useEffect(() => {
    if (!preview) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  // Keep an active row selected when the lists change.
  useEffect(() => {
    if (commandMode) {
      setActive({ kind: "commands", index: 0 });
    } else if (mentionOpen) {
      setActive({ kind: "mentions", index: 0 });
    } else {
      setActive(undefined);
    }
  }, [commandMode, mentionOpen, commandList.length, mentionRows.length]);

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

  const addChip = (chip: ChipInput) => {
    setChips((current) =>
      current.some((c) => c.path === chip.path)
        ? current
        : [
            ...current,
            {
              ...chip,
              kind: chip.kind ?? "file",
              key: `${chip.path}-${Date.now()}-${Math.random()}`,
            },
          ],
    );
    textareaRef.current?.focus();
  };

  const acceptCommand = (name: string) => {
    setText(`/${name} `);
    textareaRef.current?.focus();
  };

  const acceptMention = (row: MentionRow) => {
    setText((current) => current.replace(/@([^\s@]*)$/, ""));
    if (row.group === "selected" && row.path) {
      addChip({ path: row.path, name: row.name, kind: "selection", range: row.range });
      return;
    }
    if (row.group === "open" && row.path) {
      addChip({ path: row.path, name: row.name, kind: "file" });
      return;
    }
    const option = row.option;
    if (!option) {
      return;
    }
    if (option.kind === "skill") {
      setText((current) => `${current}@${option.label} `);
    } else {
      addChip({ path: option.value, name: option.label, kind: "file" });
    }
  };

  const stageImageFile = (file: File) => {
    const imageChips = chips.filter((c) => c.kind === "image").length;
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
        mime: file.type,
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
    // A pasted bare URL becomes a link token instead of raw text.
    const pasted = event.clipboardData.getData("text/plain").trim();
    if (/^https?:\/\/\S+$/.test(pasted)) {
      event.preventDefault();
      addChip({ path: pasted, name: pasted, kind: "url" });
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

  const previewChip = (chip: Chip) => {
    if (chip.kind === "url") {
      setPreview({ name: chip.name ?? chip.path, kind: "url", url: chip.path });
      return;
    }
    const requestId = `preview-${counter.current++}`;
    setPreview({ name: chip.name ?? fileName(chip.path), kind: chip.kind, requestId });
    dispatch({
      kind: "previewAttachment",
      requestId,
      ref: chip.path,
      start: chip.range?.start,
      end: chip.range?.end,
    });
  };

  const openChip = (chip: Chip) => {
    if (chip.kind === "image") {
      previewChip(chip);
      return;
    }
    if (chip.kind === "url") {
      dispatch({ kind: "openUrl", url: chip.path });
      return;
    }
    dispatch({
      kind: "openFile",
      path: chip.path,
      start: chip.range?.start,
      end: chip.range?.end,
    });
  };

  const removeChip = (key: string) => setChips((current) => current.filter((c) => c.key !== key));

  const acceptActive = () => {
    if (active?.kind === "commands") {
      const command = commandList[active.index];
      if (command) {
        acceptCommand(command.name);
      }
      return true;
    }
    if (active?.kind === "mentions") {
      const row = mentionRows[active.index];
      if (row) {
        acceptMention(row);
      }
      return true;
    }
    return false;
  };

  const doSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !canSend) {
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
    dispatch({
      kind: "send",
      text: trimmed,
      attachments: chips.map((chip) => ({
        ref: chip.path,
        name: chip.name ?? fileName(chip.path),
        kind: chip.kind,
        range: chip.range,
      })),
    });
    setText("");
    setChips([]);
    setActive(undefined);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && preview) {
      event.preventDefault();
      setPreview(null);
      return;
    }
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
      const length = active.kind === "commands" ? commandList.length : mentionRows.length;
      setActive({ ...active, index: (active.index + 1) % Math.max(length, 1) });
      return;
    }
    if (event.key === "ArrowUp" && active) {
      event.preventDefault();
      const length = active.kind === "commands" ? commandList.length : mentionRows.length;
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
        return;
      }
      if (busy) {
        onAbort();
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

  const attachmentSummary = (): string => {
    const counts = new Map<AttachmentKind, number>();
    for (const chip of chips) {
      counts.set(chip.kind, (counts.get(chip.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => `${KIND_WORD[kind]} ${count}`).join(" · ");
  };

  const chipHint = (chip: Chip): string => {
    const range = chip.range !== undefined ? ` (L${chip.range.start}-L${chip.range.end})` : "";
    if (chip.kind === "image") {
      return "单击 预览图片 · 发送时以 inline data URI 传递";
    }
    if (chip.kind === "url") {
      return "Ctrl+单击 在浏览器中打开 · 单击 预览链接";
    }
    return `Ctrl+单击 在编辑器中打开${range} · 单击 预览`;
  };

  const previewData = preview?.requestId ? previews[preview.requestId] : undefined;

  const renderPreviewBody = () => {
    if (!preview) {
      return null;
    }
    if (preview.kind === "url") {
      return (
        <div className="preview-url">
          <div className="preview-url-address">{preview.url}</div>
          <div className="preview-url-note">发送时以文本形式附加这个链接，由服务端取回内容。</div>
        </div>
      );
    }
    if (!previewData) {
      return <div className="preview-empty">读取中…</div>;
    }
    if (previewData.error) {
      return <div className="preview-empty">无法预览：{previewData.error}</div>;
    }
    if (previewData.dataUrl) {
      return <img className="preview-image" src={previewData.dataUrl} alt={preview.name} />;
    }
    if (previewData.text !== undefined) {
      const first = previewData.firstLine ?? 1;
      const highlight = previewData.highlight;
      return (
        <pre className="preview-code">
          {previewData.text.split("\n").map((line, index) => {
            const lineNumber = first + index;
            const hit =
              highlight !== undefined &&
              lineNumber >= highlight.start &&
              lineNumber <= highlight.end;
            return (
              <span key={index} className={hit ? "preview-line hit" : "preview-line"}>
                <span className="preview-ln">{lineNumber}</span>
                {line}
              </span>
            );
          })}
        </pre>
      );
    }
    return <div className="preview-empty">这个附件没有可预览的内容。</div>;
  };

  return (
    <div className="composer">
      <div className="composer-box">
        {chips.length > 0 && (
          <div className="token-row">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="token"
                title={chipHint(chip)}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) {
                    openChip(chip);
                  } else {
                    previewChip(chip);
                  }
                }}
              >
                <span className={`type t-${chip.kind}`}>{KIND_LABEL[chip.kind]}</span>
                <span className="token-name">{chip.name ?? fileName(chip.path)}</span>
                {chip.range && (
                  <span className="token-range">
                    L{chip.range.start}-L{chip.range.end}
                  </span>
                )}
                <button
                  className="token-x"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeChip(chip.key);
                  }}
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="token-summary">
            <span>
              {chips.length} 个附件 · {attachmentSummary()}
            </span>
            <button className="token-clear" onClick={() => setChips([])}>
              全部清除
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder={
            busy
              ? "模型处理中 · Enter 加入队列 · Esc 停止"
              : "随便问点什么， / 可查看命令， @ 可添加上下文..."
          }
          rows={1}
          disabled={!canSend}
        />
        <div className="composer-actions">
          <div className="composer-left">
            <button
              className="icon-btn"
              onClick={() => dispatch({ kind: "pickFiles", requestId: `pick-${counter.current++}` })}
              title="Attach files"
            >
              +
            </button>
            {pickers}
          </div>
          <span className="spacer" />
          <button
            className="send-btn"
            onClick={doSend}
            disabled={!text.trim() || !canSend}
            title={busy ? "Add to queue (Enter)" : "Send (Enter)"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 19V6.4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <path
                d="M5.8 12.6 12 6.4l6.2 6.2"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
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
            {mentionRows.length === 0 ? (
              <div className="mention-empty">No matching skills or files</div>
            ) : (
              mentionRows.map((row, index) => (
                <div key={row.key}>
                  {(index === 0 || mentionRows[index - 1]?.group !== row.group) && (
                    <div className="mention-section">
                      {row.group === "selected"
                        ? "当前编辑器 · 已选中"
                        : row.group === "open"
                          ? "已打开 · 无选区"
                          : "文件与技能"}
                    </div>
                  )}
                  <button
                    className={`mention-item${active?.kind === "mentions" && active.index === index ? " active" : ""}${
                      row.group === "open" ? " dim" : ""
                    }`}
                    onClick={() => acceptMention(row)}
                  >
                    <span className={`type t-${row.group === "selected" ? "selection" : "file"}`}>
                      {row.group === "selected" ? "SEL" : "FILE"}
                    </span>
                    <span className="mention-name">{row.name}</span>
                    <span className="mention-desc">{row.description}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {context && <ContextBar {...context} />}

      {preview && (
        <div className="preview-overlay" onClick={() => setPreview(null)}>
          <div className="preview-card" onClick={(event) => event.stopPropagation()}>
            <div className="preview-head">
              <span className={`type t-${preview.kind}`}>{KIND_LABEL[preview.kind]}</span>
              <span className="preview-name">{preview.name}</span>
              <span className="preview-sub">
                {preview.kind === "image"
                  ? "预览"
                  : preview.kind === "url"
                    ? "链接"
                    : preview.kind === "selection"
                      ? "选中范围"
                      : "文件"}
              </span>
              <span className="spacer" />
              <button className="preview-close" onClick={() => setPreview(null)} title="关闭 (Esc)">
                ×
              </button>
            </div>
            <div className="preview-body">{renderPreviewBody()}</div>
            <div className="preview-note">
              {preview.kind === "url"
                ? "Ctrl+单击 在浏览器中打开"
                : preview.kind === "image"
                  ? "发送时以 inline data URI 传递"
                  : "Ctrl+单击 在编辑器中打开"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fileName(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}
