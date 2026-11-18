import type { FoldedHistoryRow } from "../util/sessions";
import type { Locale } from "../util/i18n";
import type { SubmitKey } from "../util/composer-keys";
import type { SubagentJob } from "../util/subagents";
import type {
  AgentInfo,
  AssistantContent,
  CommandInfo,
  FileDiffInfo,
  FormAnswerValue,
  FormInfo,
  MessageInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  SkillInfo,
} from "../opencode/types";

/** Re-exported for the webview components that render messages. */
export type { MessageInfo };
export type { FormInfo, FormAnswerValue };

export type ConnectionState = "stopped" | "starting" | "connected" | "error";

/** Branch / dirty state shown in the context strip (absent when git is unavailable). */
export interface GitInfo {
  branch?: string;
  dirty?: boolean;
  /** The directory the branch was read from when it is not the workspace
   *  folder — a worktree or a moved session's directory (ADR-0014). */
  directory?: string;
}

export interface Catalog {
  agents: AgentInfo[];
  models: ModelInfo[];
  commands: CommandInfo[];
  skills: SkillInfo[];
  recentModels: ModelRef[];
  defaultModel?: ModelRef;
}

/** A user message held until the running turn finishes. */
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: AttachmentRef[];
}

export interface Snapshot {
  sessionID?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  busy: boolean;
  messages: MessageInfo[];
  /** True when the server may still have older messages beyond the loaded pages. */
  hasEarlier?: boolean;
  /** True while a backfill fetch of older messages is in flight. */
  loadingEarlier?: boolean;
  pending: PermissionRequest[];
  diffs: FileDiffInfo[];
  catalog: Catalog;
  /** Tokens of the latest billed assistant message — the context gauge value. */
  contextTokens?: number;
  /** Cache hit rate of the same message (0..1). */
  cacheHitRate?: number;
  workspacePath?: string;
  git?: GitInfo;
  editors?: EditorFile[];
  queue: QueuedMessage[];
  queuePaused: boolean;
  /** Pending session forms (the `question` tool) awaiting an answer. */
  forms?: FormInfo[];
  /** Subagents currently running under this session. */
  subagents?: SubagentJob[];
  /** True when the open session is a subagent's child session. */
  isSubagentSession?: boolean;
  /** The parent of the open session; present only for a subagent's child session. */
  parentSessionID?: string;
  /** The display language the panel renders copy in. */
  locale?: Locale;
}

export interface HistoryGroup {
  label: string;
  sessions: FoldedHistoryRow[];
}

/** What the user attached to a message. */
export type AttachmentKind = "image" | "file" | "selection" | "url";

export interface AttachmentRef {
  /** Staged image reference (`staged:<id>`), absolute file path, or URL. */
  ref: string;
  name: string;
  kind: AttachmentKind;
  /** 1-indexed inclusive line range; selection attachments only. */
  range?: { start: number; end: number };
}

/** An editor tab open in the window; `selected` is set only with a live selection. */
export interface EditorFile {
  path: string;
  name: string;
  selected?: { start: number; end: number };
}

export interface AttachmentPreview {
  requestId: string;
  /** Images come back inline. */
  dataUrl?: string;
  /** Files come back as a window of lines around the range. */
  text?: string;
  firstLine?: number;
  highlight?: { start: number; end: number };
  error?: string;
}

export type HostToWeb =
  | {
      kind: "state";
      state: ConnectionState;
      version?: string;
      error?: string;
      compatWarning?: string;
      /** The display language the panel renders copy in. */
      locale?: Locale;
      /** Composer behavior settings; absent keeps what the panel already has. */
      composer?: { submitKey: SubmitKey; showContextBar: boolean };
      /** Diff-list display settings; absent keeps what the panel already has. */
      diffList?: { maxVisibleRows: number };
    }
  | { kind: "imageStaged"; requestId: string; path: string; name: string; sessionID?: string }
  | { kind: "history"; groups: HistoryGroup[] }
  | { kind: "snapshot"; snapshot: Snapshot }
  | {
      kind: "sessionMeta";
      sessionID?: string;
      title?: string;
      agent?: string;
      model?: ModelRef;
      busy?: boolean;
      contextTokens?: number;
      cacheHitRate?: number;
      /** True when the open session is a subagent's child session. */
      isSubagentSession?: boolean;
      /** The parent of the open session; the back button's target. */
      parentSessionID?: string;
      /** Session timestamps, epoch ms (session info panel). */
      created?: number;
      updated?: number;
      /** Server-computed session cost, USD (0 for subscription models). */
      cost?: number;
    }
  | { kind: "git"; git: GitInfo }
  | { kind: "textStarted"; sessionID: string; messageID: string; ordinal: number }
  | { kind: "textDelta"; sessionID: string; messageID: string; ordinal: number; delta: string }
  | { kind: "textEnded"; sessionID: string; messageID: string; ordinal: number; text: string }
  | { kind: "reasoningStarted"; sessionID: string; messageID: string; ordinal: number }
  | { kind: "reasoningDelta"; sessionID: string; messageID: string; ordinal: number; delta: string }
  | { kind: "reasoningEnded"; sessionID: string; messageID: string; ordinal: number; text: string }
  /** Authoritative content of a message, pushed as it changes on the server. */
  | { kind: "messageContent"; sessionID: string; messageID: string; content: AssistantContent[] }
  | {
      kind: "messages";
      sessionID: string;
      messages: MessageInfo[];
      /** True when the server may still have older messages beyond the loaded pages. */
      hasEarlier?: boolean;
      /** True while a backfill fetch of older messages is in flight. */
      loadingEarlier?: boolean;
    }
  /** Broadcasts for a specific session; `sessionID` is required so the
   *  webview's guard cannot be bypassed by an unlabelled message. */
  | { kind: "busy"; sessionID: string; busy: boolean }
  | { kind: "queue"; sessionID: string; queue: QueuedMessage[]; paused: boolean }
  | { kind: "forms"; sessionID: string; forms: FormInfo[] }
  | { kind: "subagents"; sessionID: string; jobs: SubagentJob[] }
  | { kind: "permissions"; sessionID: string; pending: PermissionRequest[] }
  | { kind: "diffs"; sessionID: string; diffs: FileDiffInfo[] }
  | { kind: "catalog"; catalog: Catalog }
  | { kind: "editors"; editors: EditorFile[] }
  | { kind: "attachmentPreview"; preview: AttachmentPreview }
  | { kind: "error"; message: string }
  | { kind: "fileResults"; requestId: string; results: { path: string; name: string }[]; sessionID?: string }
  | { kind: "pickedPaths"; requestId: string; paths: string[]; sessionID?: string };

export type WebToHost =
  | { kind: "ready" }
  | {
      kind: "send";
      text: string;
      attachments: AttachmentRef[];
      /** Session stamp: the session the user was looking at (see `stampSession`). */
      sessionID?: string;
    }
  | { kind: "removeQueued"; id: string; sessionID?: string }
  | { kind: "forceQueued"; id: string; sessionID?: string }
  | { kind: "resumeQueue"; sessionID?: string }
  | { kind: "stopSubagent"; childSessionID: string; sessionID?: string }
  | { kind: "abort"; sessionID?: string }
  | { kind: "openFile"; path: string; start?: number; end?: number }
  | { kind: "openUrl"; url: string }
  | { kind: "copyCode"; text: string }
  | { kind: "previewAttachment"; requestId: string; ref: string; start?: number; end?: number }
  | { kind: "newSession" }
  | { kind: "showHistory" }
  | { kind: "runCommand"; command: string; arguments: string }
  | { kind: "renameSession"; id: string; currentTitle?: string }
  | { kind: "deleteSession"; id: string }
  | { kind: "forkSession"; id: string }
  | { kind: "exportSession"; id: string }
  | { kind: "openSourceControl" }
  | { kind: "revealInExplorer"; path: string }
  | { kind: "switchSession"; id: string }
  | { kind: "setAgent"; agent: string }
  | { kind: "setModel"; providerID: string; id: string; variant?: string }
  | { kind: "stageImage"; requestId: string; name: string; dataBase64: string; mime: string }
  | { kind: "rewindTo"; messageID: string }
  /** Backfill one older page of transcript history (scroll reached the top). */
  | { kind: "loadEarlier"; sessionID?: string }
  | { kind: "permissionReply"; requestID: string; decision: "once" | "always" | "reject"; sessionID?: string }
  | { kind: "formReply"; formID: string; answer: Record<string, FormAnswerValue>; sessionID?: string }
  | { kind: "formCancel"; formID: string; sessionID?: string }
  | { kind: "openDiff"; file: string }
  | { kind: "revertFile"; file: string; sessionID?: string }
  | { kind: "searchFiles"; requestId: string; query: string }
  | { kind: "pickFiles"; requestId: string }
  | { kind: "openCLI" }
  | { kind: "showLogs" }
  | { kind: "cycleAgent"; direction: 1 | -1 }
  | { kind: "restartServer" }
  | { kind: "openSettings" }
  /** Whether the user is currently looking at this surface. */
  | { kind: "focusChanged"; focused: boolean };

/**
 * Action messages whose effect belongs to the session the user was looking at
 * when they made it. During a session switch the host flips to the incoming
 * session while the webview still renders the outgoing one; a stamped action
 * lets the host drop clicks that were made against the stale surface instead
 * of firing them into the wrong conversation.
 */
type StampedAction = Extract<
  WebToHost,
  {
    kind:
      | "send"
      | "removeQueued"
      | "forceQueued"
      | "resumeQueue"
      | "abort"
      | "stopSubagent"
      | "permissionReply"
      | "formReply"
      | "formCancel"
      | "revertFile"
      | "loadEarlier";
  }
>;

/** Attach the session stamp to an outgoing action message; others pass through. */
export function stampSession(message: WebToHost, sessionID: string | undefined): WebToHost {
  switch (message.kind) {
    case "send":
      return { ...message, sessionID };
    case "removeQueued":
      return { ...message, sessionID };
    case "forceQueued":
      return { ...message, sessionID };
    case "resumeQueue":
      return { ...message, sessionID };
    case "abort":
      return { ...message, sessionID };
    case "stopSubagent":
      return { ...message, sessionID };
    case "permissionReply":
      return { ...message, sessionID };
    case "formReply":
      return { ...message, sessionID };
    case "formCancel":
      return { ...message, sessionID };
    case "revertFile":
      return { ...message, sessionID };
    case "loadEarlier":
      return { ...message, sessionID };
    default:
      return message;
  }
}

/**
 * True when an incoming action was stamped with a session the host no longer
 * hosts — a click on a surface the webview has not re-rendered past a switch
 * yet. The host drops it instead of firing it into the incoming session.
 */
export function isStaleAction(message: WebToHost, currentSessionID: string | undefined): boolean {
  const stamped = (message as Partial<StampedAction>).sessionID;
  return stamped !== undefined && stamped !== currentSessionID;
}
