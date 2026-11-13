import type {
  Catalog,
  ConnectionState,
  HostToWeb,
  Snapshot,
  WebToHost,
} from "../src/webview/protocol";
import type { AssistantMessage, FileDiffInfo, MessageInfo, PermissionRequest } from "../src/opencode/types";

export interface ChatState {
  connection: ConnectionState;
  version?: string;
  connectionError?: string;
  sessionID?: string;
  title?: string;
  agent?: string;
  model?: { providerID: string; id: string };
  busy: boolean;
  messages: MessageInfo[];
  pending: PermissionRequest[];
  diffs: FileDiffInfo[];
  catalog: Catalog;
  errors: string[];
  fileResults: Record<string, { path: string; name: string }[]>;
  pickedPaths: Record<string, string[]>;
}

export const initialState: ChatState = {
  connection: "starting",
  busy: false,
  messages: [],
  pending: [],
  diffs: [],
  catalog: { agents: [], models: [] },
  errors: [],
  fileResults: {},
  pickedPaths: {},
};

function applySnapshot(state: ChatState, snapshot: Snapshot): ChatState {
  return {
    ...state,
    sessionID: snapshot.sessionID,
    title: snapshot.title,
    agent: snapshot.agent,
    model: snapshot.model,
    busy: snapshot.busy,
    messages: snapshot.messages,
    pending: snapshot.pending,
    diffs: snapshot.diffs,
    catalog: snapshot.catalog,
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
      };
    }
    case "snapshot":
      return applySnapshot(state, message.snapshot);
    case "catalog":
      return { ...state, catalog: message.catalog };
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
      };
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
      return { ...state, busy: message.busy };
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
    default:
      return state;
  }
}

/** Sender of WebToHost messages (Composer/App dispatch). */
export type Dispatch = (message: WebToHost) => void;

export type { HostToWeb };
