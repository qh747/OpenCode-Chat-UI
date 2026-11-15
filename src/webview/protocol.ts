import type { SessionRunStatus } from "../util/sessions";
import type { Locale } from "../util/i18n";
import type {
  AgentInfo,
  AssistantContent,
  CommandInfo,
  FileDiffInfo,
  MessageInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  SkillInfo,
  TokenUsage,
} from "../opencode/types";

export type ConnectionState = "stopped" | "starting" | "connected" | "error";

/** Branch / dirty state of the workspace folder (absent when git is unavailable). */
export interface GitInfo {
  branch?: string;
  dirty?: boolean;
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
  pending: PermissionRequest[];
  diffs: FileDiffInfo[];
  catalog: Catalog;
  cost?: number;
  tokens?: TokenUsage;
  workspacePath?: string;
  git?: GitInfo;
  editors?: EditorFile[];
  queue: QueuedMessage[];
  queuePaused: boolean;
  /** The display language the panel renders copy in. */
  locale?: Locale;
}

export interface HistoryGroup {
  label: string;
  sessions: { id: string; title?: string; updated: number; status: SessionRunStatus }[];
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
    }
  | { kind: "imageStaged"; requestId: string; path: string; name: string }
  | { kind: "history"; groups: HistoryGroup[] }
  | { kind: "snapshot"; snapshot: Snapshot }
  | {
      kind: "sessionMeta";
      sessionID?: string;
      title?: string;
      agent?: string;
      model?: ModelRef;
      busy?: boolean;
      cost?: number;
      tokens?: TokenUsage;
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
  | { kind: "messages"; sessionID: string; messages: MessageInfo[] }
  | { kind: "busy"; sessionID?: string; busy: boolean }
  | { kind: "queue"; sessionID?: string; queue: QueuedMessage[]; paused: boolean }
  | { kind: "permissions"; sessionID?: string; pending: PermissionRequest[] }
  | { kind: "diffs"; sessionID?: string; diffs: FileDiffInfo[] }
  | { kind: "catalog"; catalog: Catalog }
  | { kind: "editors"; editors: EditorFile[] }
  | { kind: "attachmentPreview"; preview: AttachmentPreview }
  | { kind: "error"; message: string }
  | { kind: "fileResults"; requestId: string; results: { path: string; name: string }[] }
  | { kind: "pickedPaths"; requestId: string; paths: string[] };

export type WebToHost =
  | { kind: "ready" }
  | { kind: "send"; text: string; attachments: AttachmentRef[] }
  | { kind: "removeQueued"; id: string }
  | { kind: "forceQueued"; id: string }
  | { kind: "resumeQueue" }
  | { kind: "abort" }
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
  | { kind: "switchSession"; id: string }
  | { kind: "setAgent"; agent: string }
  | { kind: "setModel"; providerID: string; id: string; variant?: string }
  | { kind: "stageImage"; requestId: string; name: string; dataBase64: string; mime: string }
  | { kind: "rewindTo"; messageID: string }
  | { kind: "permissionReply"; requestID: string; decision: "once" | "always" | "reject" }
  | { kind: "openDiff"; file: string }
  | { kind: "keepFile"; file: string }
  | { kind: "revertFile"; file: string }
  | { kind: "searchFiles"; requestId: string; query: string }
  | { kind: "pickFiles"; requestId: string }
  | { kind: "openCLI" }
  | { kind: "showLogs" }
  | { kind: "executePlan" }
  | { kind: "cycleAgent"; direction: 1 | -1 }
  | { kind: "restartServer" }
  | { kind: "openServerConfig" }
  /** Whether the user is currently looking at this surface. */
  | { kind: "focusChanged"; focused: boolean };
