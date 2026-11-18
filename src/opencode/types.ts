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

/** A tool call as recorded on the assistant message itself (v2.3.0 message JSON). */
export interface AssistantToolCall {
  name?: string;
  status?: string;
  input?: Record<string, unknown>;
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
  /**
   * Workspace snapshot range this assistant message covered. `files` is NOT
   * "the files the turn touched": it is the content delta of the shared
   * working tree between this message's own `start`/`end` snapshot
   * revisions, so a change from any source that lands inside the window —
   * another session's turn, the panel's own disk writes, a manual edit — is
   * recorded here even when this message made no tool calls (verified live
   * against v2.3.0; server-snapshot-attribution/01). A message whose `tools`
   * array is empty called no tool, so any file it names came from such an
   * outside change; the diff list treats those claims as foreign.
   */
  snapshot?: { start?: string; end?: string; files?: string[] };
  /**
   * Tool calls recorded at message top level; empty (`[]`) for a message
   * that made none (e.g. a pure chat turn). This is the server's own record
   * of the turn's tool use — distinct from the `content` tool parts, which
   * carry the per-call render view (state, input, output).
   */
  tools?: AssistantToolCall[];
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

// --- session forms (the `question` tool) -----------------------------------
//
// The server's `question` tool creates a pending form (form.created event,
// metadata.kind === "question") and blocks the turn until the client answers
// via POST /api/session/{id}/form/{formID}/reply or cancels via DELETE.
// Verified live against v2.3.0: string fields answer with a plain string,
// multiselect fields with an array of strings.

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

interface FormFieldBase {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  /** Accepts a free-form answer in addition to the listed options. */
  custom?: boolean;
  placeholder?: string;
}

export interface StringFormField extends FormFieldBase {
  type: "string";
  options?: FormOption[];
  default?: string;
  placeholder?: string;
}

export interface MultiselectFormField extends FormFieldBase {
  type: "multiselect";
  options: FormOption[];
  default?: string[];
  minItems?: number;
  maxItems?: number;
}

/**
 * Fields the question tool produces. The server schema also allows
 * number/integer/boolean/external fields; they never come from `question`,
 * so unknown kinds are tolerated at runtime but not modelled here.
 */
export type FormField = StringFormField | MultiselectFormField;

export interface FormInfo {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  fields: FormField[];
}

/** What a form field answers with: plain string for `string`, array for `multiselect`. */
export type FormAnswerValue = string | string[];

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
