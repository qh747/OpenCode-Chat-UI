import type {
  AgentInfo,
  FileDiffInfo,
  MessageInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
} from "../opencode/types";

export type ConnectionState = "stopped" | "starting" | "connected" | "error";

export interface Catalog {
  agents: AgentInfo[];
  models: ModelInfo[];
  defaultModel?: ModelRef;
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
}

export type HostToWeb =
  | { kind: "state"; state: ConnectionState; version?: string; error?: string; compatWarning?: string }
  | { kind: "imageStaged"; requestId: string; path: string; name: string }
  | { kind: "snapshot"; snapshot: Snapshot }
  | { kind: "sessionMeta"; sessionID?: string; title?: string; agent?: string; model?: ModelRef; busy?: boolean }
  | { kind: "textStarted"; sessionID: string; messageID: string }
  | { kind: "textDelta"; sessionID: string; messageID: string; delta: string }
  | { kind: "reasoningDelta"; sessionID: string; messageID: string; delta: string }
  | { kind: "messages"; sessionID: string; messages: MessageInfo[] }
  | { kind: "busy"; sessionID?: string; busy: boolean }
  | { kind: "permissions"; sessionID?: string; pending: PermissionRequest[] }
  | { kind: "diffs"; sessionID?: string; diffs: FileDiffInfo[] }
  | { kind: "catalog"; catalog: Catalog }
  | { kind: "error"; message: string }
  | { kind: "fileResults"; requestId: string; results: { path: string; name: string }[] }
  | { kind: "pickedPaths"; requestId: string; paths: string[] };

export type WebToHost =
  | { kind: "ready" }
  | { kind: "send"; text: string; files: string[] }
  | { kind: "abort" }
  | { kind: "newSession" }
  | { kind: "switchSession"; id: string }
  | { kind: "setAgent"; agent: string }
  | { kind: "setModel"; providerID: string; id: string; variant?: string }
  | { kind: "stageImage"; requestId: string; name: string; dataBase64: string }
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
  | { kind: "restartServer" };
