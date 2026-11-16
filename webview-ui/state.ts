import type {
  AttachmentPreview,
  Catalog,
  ConnectionState,
  EditorFile,
  GitInfo,
  HistoryGroup,
  HostToWeb,
  QueuedMessage,
  Snapshot,
  WebToHost,
} from "../src/webview/protocol";
import type { SubmitKey } from "../src/util/composer-keys";
import type {
  AssistantContent,
  AssistantMessage,
  FileDiffInfo,
  MessageInfo,
  PermissionRequest,
} from "../src/opencode/types";
import type { SegmentKind } from "../src/util/live-segments";
import type { SubagentJob } from "../src/util/subagents";
import { locatePart } from "../src/util/live-segments";

export interface ChatState {
  connection: ConnectionState;
  version?: string;
  connectionError?: string;
  compatWarning?: string;
  sessionID?: string;
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  busy: boolean;
  queue: QueuedMessage[];
  queuePaused: boolean;
  /** Subagents currently running under this session. */
  subagents: SubagentJob[];
  /** True when the open session is a subagent's child session. */
  isSubagentSession: boolean;
  messages: MessageInfo[];
  pending: PermissionRequest[];
  diffs: FileDiffInfo[];
  catalog: Catalog;
  /** True once the first catalog (or snapshot carrying one) has arrived. */
  catalogLoaded: boolean;
  /** True once the host's first snapshot has been applied. */
  hydrated: boolean;
  errors: string[];
  fileResults: Record<string, { path: string; name: string }[]>;
  pickedPaths: Record<string, string[]>;
  stagedImages: Record<string, { path: string; name: string }>;
  historyGroups: HistoryGroup[];
  /** Tokens of the latest billed assistant message — the context gauge value. */
  contextTokens?: number;
  /** Cache hit rate of the same message (0..1). */
  cacheHitRate?: number;
  /** Session timestamps, epoch ms — the session info panel. */
  created?: number;
  updated?: number;
  /** Server-computed session cost, USD (0 for subscription models). */
  cost?: number;
  workspacePath?: string;
  git?: GitInfo;
  editors: EditorFile[];
  previews: Record<string, AttachmentPreview>;
  submitKey: SubmitKey;
  showContextBar: boolean;
  maxVisibleDiffRows: number;
}

export const initialState: ChatState = {
  connection: "starting",
  busy: false,
  queue: [],
  queuePaused: false,
  subagents: [],
  isSubagentSession: false,
  messages: [],
  pending: [],
  diffs: [],
  catalog: { agents: [], models: [], commands: [], skills: [], recentModels: [] },
  catalogLoaded: false,
  hydrated: false,
  errors: [],
  fileResults: {},
  pickedPaths: {},
  stagedImages: {},
  historyGroups: [],
  editors: [],
  previews: {},
  submitKey: "enter",
  showContextBar: true,
  maxVisibleDiffRows: 5,
};

function applySnapshot(state: ChatState, snapshot: Snapshot): ChatState {
  return {
    ...state,
    sessionID: snapshot.sessionID,
    title: snapshot.title,
    agent: snapshot.agent,
    model: snapshot.model,
    busy: snapshot.busy,
    queue: snapshot.queue,
    queuePaused: snapshot.queuePaused,
    subagents: snapshot.subagents ?? [],
    isSubagentSession: snapshot.isSubagentSession ?? false,
    messages: snapshot.messages,
    pending: snapshot.pending,
    diffs: snapshot.diffs,
    catalog: snapshot.catalog,
    catalogLoaded: true,
    hydrated: true,
    contextTokens: snapshot.contextTokens,
    cacheHitRate: snapshot.cacheHitRate,
    workspacePath: snapshot.workspacePath,
    git: snapshot.git,
    editors: snapshot.editors ?? state.editors,
  };
}

type StreamPart = Extract<AssistantContent, { type: "text" } | { type: "reasoning" }>;

function partIndex(content: AssistantContent[], kind: SegmentKind, ordinal: number): number {
  return locatePart(content, kind, ordinal);
}

function ensurePart(
  content: AssistantContent[],
  kind: SegmentKind,
  ordinal: number,
): AssistantContent[] {
  if (partIndex(content, kind, ordinal) >= 0) {
    return content;
  }
  return [...content, { type: kind, text: "" } as StreamPart];
}

function editPart(
  content: AssistantContent[],
  kind: SegmentKind,
  ordinal: number,
  edit: (text: string) => string,
): AssistantContent[] {
  const ensured = ensurePart(content, kind, ordinal);
  const index = partIndex(ensured, kind, ordinal);
  const next = [...ensured];
  const part = next[index] as StreamPart;
  next[index] = { ...part, text: edit(part.text) };
  return next;
}

function withAssistant(
  state: ChatState,
  messageID: string,
  transform: (message: AssistantMessage) => AssistantMessage,
): ChatState {
  const index = state.messages.findIndex(
    (candidate) => candidate.type === "assistant" && candidate.id === messageID,
  );
  if (index < 0) {
    return state;
  }
  const messages = [...state.messages];
  messages[index] = transform(state.messages[index] as AssistantMessage);
  return { ...state, messages };
}

/** The first events of a turn can arrive before the message list mentions it. */
function ensureAssistant(state: ChatState, messageID: string): ChatState {
  const known = state.messages.some(
    (candidate) => candidate.type === "assistant" && candidate.id === messageID,
  );
  if (known) {
    return state;
  }
  const synthetic: AssistantMessage = {
    type: "assistant",
    id: messageID,
    time: { created: Date.now() },
    content: [],
  };
  return { ...state, messages: [...state.messages, synthetic] };
}

export function reducer(state: ChatState, message: HostToWeb): ChatState {
  switch (message.kind) {
    case "state": {
      const cleared = message.state === "connected" ? { errors: [] as string[] } : {};
      return {
        ...state,
        ...cleared,
        connection: message.state,
        version: message.version ?? state.version,
        connectionError: message.error,
        compatWarning: message.compatWarning,
        submitKey: message.composer?.submitKey ?? state.submitKey,
        showContextBar: message.composer?.showContextBar ?? state.showContextBar,
        maxVisibleDiffRows: message.diffList?.maxVisibleRows ?? state.maxVisibleDiffRows,
      };
    }
    case "snapshot":
      return applySnapshot(state, message.snapshot);
    case "catalog":
      return { ...state, catalog: message.catalog, catalogLoaded: true };
    case "editors":
      return { ...state, editors: message.editors };
    case "attachmentPreview":
      return {
        ...state,
        previews: { ...state.previews, [message.preview.requestId]: message.preview },
      };
    case "sessionMeta": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      return {
        ...state,
        title: message.title ?? state.title,
        agent: message.agent ?? state.agent,
        model: message.model ?? state.model,
        busy: message.busy ?? state.busy,
        contextTokens: message.contextTokens ?? state.contextTokens,
        cacheHitRate: message.cacheHitRate ?? state.cacheHitRate,
        isSubagentSession: message.isSubagentSession ?? state.isSubagentSession,
        created: message.created ?? state.created,
        updated: message.updated ?? state.updated,
        cost: message.cost ?? state.cost,
      };
    }
    case "git": {
      return { ...state, git: message.git };
    }
    case "textStarted":
    case "reasoningStarted": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      const kind: SegmentKind = message.kind === "textStarted" ? "text" : "reasoning";
      const next = ensureAssistant(state, message.messageID);
      return withAssistant(next, message.messageID, (assistant) => ({
        ...assistant,
        content: ensurePart(assistant.content, kind, message.ordinal),
      }));
    }
    case "textDelta":
    case "reasoningDelta": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      const kind: SegmentKind = message.kind === "textDelta" ? "text" : "reasoning";
      const next = ensureAssistant(state, message.messageID);
      return withAssistant(next, message.messageID, (assistant) => ({
        ...assistant,
        content: editPart(assistant.content, kind, message.ordinal, (text) => text + message.delta),
      }));
    }
    case "textEnded":
    case "reasoningEnded": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      const kind: SegmentKind = message.kind === "textEnded" ? "text" : "reasoning";
      const next = ensureAssistant(state, message.messageID);
      return withAssistant(next, message.messageID, (assistant) => ({
        ...assistant,
        content: editPart(assistant.content, kind, message.ordinal, () => message.text),
      }));
    }
    case "messageContent": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      // The server's own content array wins over anything assembled locally.
      const next = ensureAssistant(state, message.messageID);
      return withAssistant(next, message.messageID, (assistant) => ({
        ...assistant,
        content: message.content,
      }));
    }
    case "messages": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      return { ...state, messages: message.messages };
    }
    case "busy": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      // Inline failures belong to the turn that produced them: once a new turn
      // starts they no longer describe the current state of the conversation.
      return { ...state, busy: message.busy, errors: message.busy ? [] : state.errors };
    }
    case "queue": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      return { ...state, queue: message.queue, queuePaused: message.paused };
    }
    case "subagents": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      return { ...state, subagents: message.jobs };
    }
    case "permissions": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      return { ...state, pending: message.pending };
    }
    case "diffs": {
      if (message.sessionID !== undefined && message.sessionID !== state.sessionID) {
        return state;
      }
      return { ...state, diffs: message.diffs };
    }
    case "error":
      return { ...state, errors: [...state.errors.slice(-2), message.message] };
    case "fileResults":
      return { ...state, fileResults: { ...state.fileResults, [message.requestId]: message.results } };
    case "pickedPaths":
      return { ...state, pickedPaths: { ...state.pickedPaths, [message.requestId]: message.paths } };
    case "imageStaged":
      return {
        ...state,
        stagedImages: {
          ...state.stagedImages,
          [message.requestId]: { path: message.path, name: message.name },
        },
      };
    case "history":
      return { ...state, historyGroups: message.groups };
    default:
      return state;
  }
}

/** Sender of WebToHost messages (Composer/App dispatch). */
export type Dispatch = (message: WebToHost) => void;

export type { HostToWeb };
