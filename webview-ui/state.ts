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
import type {
  AssistantMessage,
  FileDiffInfo,
  MessageInfo,
  PermissionRequest,
  TokenUsage,
} from "../src/opencode/types";

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
  cost?: number;
  tokens?: TokenUsage;
  workspacePath?: string;
  git?: GitInfo;
  editors: EditorFile[];
  previews: Record<string, AttachmentPreview>;
}

export const initialState: ChatState = {
  connection: "starting",
  busy: false,
  queue: [],
  queuePaused: false,
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
    messages: snapshot.messages,
    pending: snapshot.pending,
    diffs: snapshot.diffs,
    catalog: snapshot.catalog,
    catalogLoaded: true,
    hydrated: true,
    cost: snapshot.cost,
    tokens: snapshot.tokens,
    workspacePath: snapshot.workspacePath,
    git: snapshot.git,
    editors: snapshot.editors ?? state.editors,
  };
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
        cost: message.cost ?? state.cost,
        tokens: message.tokens ?? state.tokens,
      };
    }
    case "git": {
      return { ...state, git: message.git };
    }
    case "textStarted": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      if (state.messages.some((m) => m.type === "assistant" && m.id === message.messageID)) {
        return state;
      }
      const synthetic = {
        type: "assistant" as const,
        id: message.messageID,
        time: { created: Date.now() },
        content: [],
      };
      return { ...state, messages: [...state.messages, synthetic] };
    }
    case "textDelta": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.type !== "assistant" || m.id !== message.messageID) {
            return m;
          }
          const assistant = m as AssistantMessage;
          const content = [...assistant.content];
          const textParts = content.filter((c) => c.type === "text");
          const last = textParts[textParts.length - 1];
          if (last?.type === "text") {
            const index = content.indexOf(last);
            content[index] = { type: "text", text: last.text + message.delta };
          } else {
            content.push({ type: "text", text: message.delta });
          }
          return { ...assistant, content };
        }),
      };
    }
    case "reasoningDelta": {
      if (message.sessionID !== state.sessionID) {
        return state;
      }
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.type !== "assistant" || m.id !== message.messageID) {
            return m;
          }
          const assistant = m as AssistantMessage;
          const content = [...assistant.content];
          const reasoningParts = content.filter((c) => c.type === "reasoning");
          const last = reasoningParts[reasoningParts.length - 1];
          if (last?.type === "reasoning") {
            const index = content.indexOf(last);
            content[index] = { type: "reasoning", text: last.text + message.delta };
          } else {
            content.push({ type: "reasoning", text: message.delta });
          }
          return { ...assistant, content };
        }),
      };
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
