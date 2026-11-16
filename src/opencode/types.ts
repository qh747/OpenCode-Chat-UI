/**
 * Types mirroring the opencode v2 HTTP API (verified against v2.2.7 OpenAPI).
 * Only the surface this extension consumes is modelled.
 */

export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionInfo {
  id: string;
  projectID: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  cost: number;
  tokens: TokenUsage;
  time: {
    created: number;
    updated: number;
    busy?: number;
    idle?: number;
    viewed?: number;
    archived?: number;
  };
  outcome?: "succeeded" | "failed" | "interrupted";
  /** Present after a rewind; the session history is hidden past this message. */
  revert?: { messageID?: string };
  metadata?: Record<string, unknown>;
  location: { directory: string };
}

export interface ListPage<T> {
  data: T[];
  cursor: { previous?: string | null; next?: string | null };
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  model?: ModelRef;
  color?: unknown;
  permissions?: unknown;
}

export interface ProviderInfo {
  id: string;
  name: string;
  activation: "auto" | "enabled" | "disabled";
  canonical?: string;
}

export interface ModelVariant {
  id: string;
}

export interface ModelInfo {
  providerID: string;
  modelID: string;
  name: string;
  family?: string;
  type?: string;
  variants?: ModelVariant[];
  limit?: { context?: number; output?: number };
  capabilities?: { tools?: boolean };
}

export interface CommandInfo {
  name: string;
  description?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  path?: string;
  content?: string;
}

/**
 * POST /api/session/{id}/prompt body attachment. `uri` must be a `data:` or
 * `file:` URL — the server resolves it with `new URL()` and rejects bare
 * filesystem paths with "Unsupported attachment URI".
 */
export interface PromptFileAttachment {
  uri: string;
  source?: { type: "inline" } | { type: "uri"; uri: string };
  name?: string;
  description?: string;
  mention?: { start: number; end: number; text: string };
}

/** Attachment shape returned inside historical user messages (contains base64 data). */
export interface StoredFileAttachment {
  data: string;
  mime: string;
  source?: { type: "inline" } | { type: "uri"; uri: string };
  name?: string;
  description?: string;
}

export interface ToolContentChunk {
  type: string;
  text?: string;
}

export type ToolState =
  | { status: "streaming"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; metadata: Record<string, unknown> }
  | {
      status: "completed";
      input: Record<string, unknown>;
      content: ToolContentChunk[];
      metadata?: Record<string, unknown>;
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      /** Why the tool failed; carried by the part itself, not by `metadata`. */
      error?: { type?: string; message?: string; status?: number };
      content?: ToolContentChunk[];
      metadata?: Record<string, unknown>;
    };

export type AssistantContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; time?: { created: number; completed?: number } }
  | {
      type: "tool";
      id: string;
      name: string;
      state: ToolState;
      time?: { created: number; ran?: number; completed?: number };
    };

export interface UserMessage {
  type: "user";
  id: string;
  time: { created: number };
  text: string;
  files?: StoredFileAttachment[];
}

export interface AssistantMessage {
  type: "assistant";
  id: string;
  time: { created: number; streamed?: number; completed?: number };
  agent?: string;
  model?: ModelRef;
  content: AssistantContent[];
  finish?: string;
  cost?: number;
  tokens?: TokenUsage;
  error?: { message?: string; code?: string };
}

export type MessageInfo = UserMessage | AssistantMessage | { type: string; id: string };

export interface FileDiffInfo {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

export type PermissionDecision = "once" | "always" | "reject";

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  message?: string;
  source?: { type: string; messageID?: string; id?: string };
}

/** Status of a background job reported by GET /api/experimental/job. */
export type JobStatus = "running" | "completed" | "error" | "cancelled";

/**
 * Background job owned by a session. Subagents are the job kind this extension
 * surfaces: a `task` tool call runs as a child session the user can stop.
 */
export interface JobInfo {
  kind: "subagent" | "shell" | "image";
  id: string;
  sessionID: string;
  status: JobStatus;
  title?: string;
  time: { started: number; completed?: number };
  /** Subagent jobs only: the child session the agent runs in. */
  childSessionID?: string;
  /** Subagent jobs only: display name of the agent (e.g. "General"). */
  agent?: string;
  /** Subagent jobs only: the task description given to the agent. */
  description?: string;
}

/** Envelope for every SSE event delivered on GET /api/event. */
export interface OEvent {
  id: string;
  type: string;
  created: number;
  location?: { directory?: string };
  data: Record<string, unknown>;
}

export interface ServerInfo {
  version: string;
  pid?: number;
  hostname?: string;
  urls?: string[];
}
