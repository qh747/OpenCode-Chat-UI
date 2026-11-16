import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "./state";
import type { ChipInput, ComposerHandle } from "./composerTypes";
import { ComposerDraftStore } from "./composerDrafts";
import { ContextBar } from "./ContextBar";
import type { ContextBarProps } from "./ContextBar";
import { BUILTIN_COMMANDS, filterCommands, filterSkills, mergeMentions, splitCommandInput } from "../src/util/commands";
import type { CommandInfoLike, MentionOption, SkillOption } from "../src/util/commands";
import type { CommandInfo, SkillInfo } from "../src/opencode/types";
import type { AttachmentKind, AttachmentPreview, EditorFile } from "../src/webview/protocol";
import { shouldSend, type SubmitKey } from "../src/util/composer-keys";
import { mentionTail } from "../src/util/mention-trigger";
import { t, type MessageKey } from "../src/util/i18n";

const MAX_IMAGES = 6;

const KIND_LABEL: Record<AttachmentKind, string> = {
  image: "IMG",
  file: "FILE",
  selection: "SEL",
  url: "URL",
};

const KIND_WORD: Record<AttachmentKind, MessageKey> = {
  image: "kindWord.image",
  file: "kindWord.file",
  selection: "kindWord.selection",
  url: "kindWord.url",
};

const BUILTIN_DESCRIPTIONS: Record<string, MessageKey> = {
  new: "builtin.new",
  undo: "builtin.undo",
  compact: "builtin.compact",
  fork: "builtin.fork",
  export: "builtin.export",
};

interface ComposerProps {
  dispatch: Dispatch;
  busy: boolean;
  canSend: boolean;
  /** Which keystroke sends the message (Shift+Enter always a newline). */
  submitKey: SubmitKey;
  /** The open session; drafts and attachments are bucketed per session. */
  sessionID?: string;
  /** Mode/model/effort pickers rendered into the composer action bar. */
  pickers?: React.ReactNode;
  /** Number of messages waiting in this session's queue (drives the busy hint). */
  queuedCount?: number;
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
  submitKey,
  sessionID,
  pickers,
  queuedCount,
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
  /** Esc 抑制的那个 `@` 的下标；null = 未抑制。同一 `@` 保持抑制，
   *  新 `@`（下标不同）自动重新武装（spec 分支 3，Q11）。 */
  const [suppressedAt, setSuppressedAt] = useState<number | null>(null);
  /** 最近一次输入/选择事件的光标位置；触发检测按光标前缀计算。 */
  const [caret, setCaret] = useState<number | undefined>(undefined);
  /** 中文输入法组合期间不触发/不重置补全（Q10b）。 */
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState<ActiveList>(undefined);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const counter = useRef(0);
  const mentionRequestId = useRef("");
  /** chips 的实时镜像：document 级 paste 监听用，规避闭包过期。 */
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  /** 草稿的实时镜像：会话切换时存入旧会话的桶（规避闭包过期）。 */
  const textRef = useRef(text);
  textRef.current = text;
  /** 按会话分桶的草稿仓：切走存旧、切回取新，互不串桶。 */
  const draftsRef = useRef(new ComposerDraftStore<Chip>());
  const sessionRef = useRef(sessionID);

  // 会话切换：把当前草稿存回旧会话，恢复新会话自己的草稿（默认为空）。
  // 补全弹层、预览等瞬态一律清空，与"内容只在所属会话呈现"一致。
  useEffect(() => {
    if (sessionRef.current === sessionID) {
      return;
    }
    const from = sessionRef.current;
    sessionRef.current = sessionID;
    const restored = draftsRef.current.switch(from, sessionID, {
      text: textRef.current,
      chips: chipsRef.current,
    });
    setText(restored.text);
    setChips(restored.chips);
    setCaret(restored.text.length);
    setSuppressedAt(null);
    setActive(undefined);
    setPreview(null);
    setImageNotice(undefined);
    // text/chips 读自 ref，故意不进依赖：切换时取"当时的"草稿而非跟随重渲。
  }, [sessionID]);

  const commandMode = text.startsWith("/");
  const commandQuery = commandMode ? text.slice(1) : "";
  const commandList = (() => {
    const builtin = BUILTIN_COMMANDS.map((c) => {
      const descriptionKey = BUILTIN_DESCRIPTIONS[c.name];
      return { ...c, description: descriptionKey ? t(descriptionKey) : "" };
    });
    const merged: CommandInfoLike[] = [...builtin];
    for (const c of commands) {
      if (!merged.some((m) => m.name === c.name)) {
        merged.push(c);
      }
    }
    return filterCommands(merged, commandQuery.replace(/\s+.*$/, ""));
  })();
  const skillRows = commandMode
    ? filterSkills(skills, commandQuery.replace(/\s+.*$/, ""))
    : [];
  /** 光标前缀内的尾部 `@` 触发；渲染期随 text/caret 重算，永不会与文本脱节。 */
  const mentionTailInfo = composing ? undefined : mentionTail(text, caret);
  const mentionQuery = mentionTailInfo?.query;
  const mentionOpen =
    mentionTailInfo !== undefined &&
    !commandMode &&
    suppressedAt !== mentionTailInfo.atIndex;

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
        description: t("mentionSelectedHint", {
          range: `L${editor.selected?.start}-${editor.selected?.end}`,
        }),
      }));
    // Open but unselected files are suggestions, never citable ranges.
    const open: MentionRow[] = editors
      .filter((editor) => !editor.selected && matches(editor.name))
      .map((editor) => ({
        group: "open" as const,
        key: `open-${editor.path}`,
        name: editor.name,
        path: editor.path,
        description: t("mentionGroupOpen"),
      }));
    const other: MentionRow[] = mergeMentions(
      fileResults[mentionRequestId.current] ?? [],
      mentionQuery ?? "",
    ).map((option) => ({
      group: "other" as const,
      key: option.value,
      name: option.label,
      description: option.description,
      option,
    }));
    return [...selected, ...open, ...other];
  }, [mentionOpen, mentionQuery, editors, fileResults]);

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
  }, [commandMode, mentionOpen, commandList.length, skillRows.length, mentionRows.length]);

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

  const handleChange = (value: string, selectionStart: number | undefined) => {
    setText(value);
    setCaret(selectionStart ?? value.length);
    // 被抑制的那个 `@` 已不在原下标（被删除/清空），或 `@` 后出现了空格
    // （spec 分支 3：空格后解除抑制）→ 解除抑制，重新武装。
    if (suppressedAt !== null && (value[suppressedAt] !== "@" || value[suppressedAt + 1] === " ")) {
      setSuppressedAt(null);
    }
    if (composing) {
      // IME 组合期间不打搜索请求、不重置抑制；compositionend 后统一评估。
      return;
    }
    const next = mentionTail(value, selectionStart ?? value.length);
    if (next && !value.startsWith("/") && suppressedAt !== next.atIndex) {
      requestMention(next.query);
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

  /** Selecting a skill inserts its mention (`@<id>` — the id, not the display
   *  name, is what the server resolves) and suppresses the file picker that
   *  the fresh `@` tail would otherwise open. */
  const acceptSkill = (skill: SkillOption) => {
    setText(`@${skill.id} `);
    // 刚插入的 `@` 在下标 0；抑制它，避免新尾部再次弹开文件补全。
    setSuppressedAt(0);
    textareaRef.current?.focus();
  };

  const acceptMention = (row: MentionRow) => {
    // 按触发信息精确移除 `@query`（光标不在文末时也不能多删）。
    if (mentionTailInfo) {
      const { atIndex, caret: tailCaret } = mentionTailInfo;
      setText((current) => current.slice(0, atIndex) + current.slice(tailCaret));
      setCaret(atIndex);
    }
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
    addChip({ path: option.value, name: option.label, kind: "file" });
  };

  const stageImageFile = (file: File) => {
    const imageChips = chipsRef.current.filter((c) => c.kind === "image").length;
    if (imageChips >= MAX_IMAGES) {
      setImageNotice(t("maxImages", { count: MAX_IMAGES }));
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
    // 图片粘贴已在 document 级监听统一处理（焦点不在输入框也能粘贴）；
    // 这里只负责文本类粘贴：裸 URL 变成链接 token 而非原文。
    const pasted = event.clipboardData.getData("text/plain").trim();
    if (/^https?:\/\/\S+$/.test(pasted)) {
      event.preventDefault();
      addChip({ path: pasted, name: pasted, kind: "url" });
    }
  };

  // 图片粘贴监听挂在 webview document 级（spec 分支 9）：外部复制图片后
  // 焦点常不在输入框，textarea 的 paste 事件根本不会触发。命中图片即
  // preventDefault 并进暂存流程；纯文本粘贴不受影响。
  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            stageImageFile(file);
          }
        }
      }
    };
    document.addEventListener("paste", onWindowPaste);
    return () => document.removeEventListener("paste", onWindowPaste);
  }, []);

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
      if (active.index < commandList.length) {
        const command = commandList[active.index];
        if (command) {
          acceptCommand(command.name);
          return true;
        }
      } else {
        const skill = skillRows[active.index - commandList.length];
        if (skill) {
          acceptSkill(skill);
          return true;
        }
      }
      // 列表为空/无高亮项：不吞 Enter（spec 分支 3，Q9）。
      return false;
    }
    if (active?.kind === "mentions") {
      const row = mentionRows[active.index];
      if (row) {
        acceptMention(row);
        return true;
      }
      return false;
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
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      // Command and mention confirmation stays on bare Enter regardless of
      // the send keystroke; only sending the message itself is configurable.
      if (commandMode && !event.shiftKey) {
        event.preventDefault();
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
      if (mentionOpen && !event.shiftKey) {
        event.preventDefault();
        if (acceptActive()) {
          return;
        }
      }
      if (shouldSend(submitKey, event.nativeEvent)) {
        event.preventDefault();
        doSend();
      }
      return;
    }
    if (event.key === "ArrowDown" && active) {
      event.preventDefault();
      const length = active.kind === "commands" ? commandList.length + skillRows.length : mentionRows.length;
      setActive({ ...active, index: (active.index + 1) % Math.max(length, 1) });
      return;
    }
    if (event.key === "ArrowUp" && active) {
      event.preventDefault();
      const length = active.kind === "commands" ? commandList.length + skillRows.length : mentionRows.length;
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
      if (mentionOpen && mentionTailInfo) {
        // 抑制当前这个 `@`：补全关闭且不会因继续打字重新弹出（Q11）。
        setSuppressedAt(mentionTailInfo.atIndex);
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
    return [...counts.entries()].map(([kind, count]) => `${t(KIND_WORD[kind])} ${count}`).join(" · ");
  };

  const chipHint = (chip: Chip): string => {
    const range = chip.range !== undefined ? ` (L${chip.range.start}-L${chip.range.end})` : "";
    if (chip.kind === "image") {
      return t("chipHintImage");
    }
    if (chip.kind === "url") {
      return t("chipHintUrl");
    }
    return t("chipHintFile", { range });
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
          <div className="preview-url-note">{t("urlPreviewNote")}</div>
        </div>
      );
    }
    if (!previewData) {
      return <div className="preview-empty">{t("reading")}</div>;
    }
    if (previewData.error) {
      return <div className="preview-empty">{t("previewFailed", { error: previewData.error })}</div>;
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
    return <div className="preview-empty">{t("previewEmpty")}</div>;
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
                  aria-label={t("removeAttachment")}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="token-summary">
            <span>{t("attachmentSummaryLine", { count: chips.length, summary: attachmentSummary() })}</span>
            <button className="token-clear" onClick={() => setChips([])}>
              {t("clearAll")}
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => handleChange(event.target.value, event.target.selectionStart ?? undefined)}
          onSelect={(event) => {
            // 光标移动也要重新评估触发（光标离开 `@` 尾部时弹层应关闭）。
            if (!composing) {
              setCaret(event.currentTarget.selectionStart ?? undefined);
            }
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            const el = event.currentTarget;
            const next = mentionTail(el.value, el.selectionStart ?? undefined);
            if (next && !el.value.startsWith("/") && suppressedAt !== next.atIndex) {
              requestMention(next.query);
            }
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder={busy ? t("composerPlaceholderBusy") : t("composerPlaceholder")}
          rows={1}
          disabled={!canSend}
        />
        <div className="composer-actions">
          <div className="composer-left">
            <button
              className="icon-btn"
              onClick={() => dispatch({ kind: "pickFiles", requestId: `pick-${counter.current++}` })}
              title={t("attachFilesTitle")}
            >
              +
            </button>
            {pickers}
            {busy && (queuedCount ?? 0) > 0 && (
              <span className="queued-hint">{t("queuedHint", { count: queuedCount ?? 0 })}</span>
            )}
          </div>
          <span className="spacer" />
          {busy ? (
            // 任务执行中：同一位置变为停止按钮（点击中断，Esc 同效）；
            // 输入框保持可输入，Enter 按设置的发送键排队。
            <button className="send-btn stop" onClick={onAbort} title={t("stopTitle")}>
              <span className="stop-square" aria-hidden="true" />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={doSend}
              disabled={!text.trim() || !canSend}
              title={t("sendTitle")}
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
          )}
        </div>
        {imageNotice && <div className="image-notice">{imageNotice}</div>}
        {commandMode && (commandList.length > 0 || skillRows.length > 0) && (
          <div className="mention-list" ref={listRef}>
            {
              <>
                {commandList.map((command, index) => (
                  <button
                    key={command.name}
                    className={`mention-item${active?.kind === "commands" && active.index === index ? " active" : ""}`}
                    onClick={() => acceptCommand(command.name)}
                  >
                    <span className="mention-name">/{command.name}</span>
                    <span className="mention-desc">{commandDescription(command.name)}</span>
                  </button>
                ))}
                {skillRows.length > 0 && (
                  <div className="mention-section">{t("commandGroupSkills")}</div>
                )}
                {skillRows.map((skill, index) => (
                  <button
                    key={`skill-${skill.id}`}
                    className={`mention-item${
                      active?.kind === "commands" && active.index === commandList.length + index ? " active" : ""
                    }`}
                    onClick={() => acceptSkill(skill)}
                  >
                    <span className="mention-name">{skill.name}</span>
                    <span className="mention-desc">{skill.description}</span>
                  </button>
                ))}
              </>
            }
          </div>
        )}
        {/* 无匹配即关闭弹层：不再渲染“没有匹配的文件”空态（spec 分支 3，Q9）。 */}
        {mentionOpen && mentionRows.length > 0 && (
          <div className="mention-list" ref={listRef}>
            {
              mentionRows.map((row, index) => (
                <div key={row.key}>
                  {(index === 0 || mentionRows[index - 1]?.group !== row.group) && (
                    <div className="mention-section">
                      {row.group === "selected"
                        ? t("mentionGroupSelected")
                        : row.group === "open"
                          ? t("mentionGroupOpen")
                          : t("mentionGroupOther")}
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
            }
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
              <span className="preview-sub">{t(KIND_WORD[preview.kind])}</span>
              <span className="spacer" />
              <button className="preview-close" onClick={() => setPreview(null)} title={t("closePreview")}>
                ×
              </button>
            </div>
            <div className="preview-body">{renderPreviewBody()}</div>
            <div className="preview-note">
              {preview.kind === "url"
                ? t("previewNote.url")
                : preview.kind === "image"
                  ? t("previewNote.image")
                  : t("previewNote.file")}
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
