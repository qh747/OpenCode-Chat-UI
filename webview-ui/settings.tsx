import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanel } from "./SettingsPanel";
import { resolveLocale, setLocale } from "../src/util/i18n";
import type {
  SettingsChoice,
  SettingsHostToWeb,
  SettingsItemState,
  SettingsScope,
  SettingsWebToHost,
} from "../src/webview/settings-protocol";

interface VsCodeApi {
  postMessage(message: SettingsWebToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

interface State {
  items: SettingsItemState[];
  scope: SettingsScope;
  targetPath?: string;
  targetMissing?: boolean;
  externalServer?: boolean;
  version?: string;
  connected?: boolean;
  models: SettingsChoice[];
  agents: SettingsChoice[];
  shells: SettingsChoice[];
  error?: string;
  saved?: string;
}

const initialState: State = {
  items: [],
  scope: "global",
  models: [],
  agents: [],
  shells: [],
};

function reducer(state: State, message: SettingsHostToWeb): State {
  switch (message.kind) {
    case "settings":
      return {
        ...state,
        items: message.items,
        scope: message.scope,
        targetPath: message.targetPath,
        targetMissing: message.targetMissing,
        externalServer: message.externalServer,
        version: message.version,
        connected: message.connected,
        models: message.models ?? [],
        agents: message.agents ?? [],
        shells: message.shells ?? [],
        error: message.error,
      };
    case "settingsError":
      return { ...state, error: message.message };
    case "settingsSaved":
      return { ...state, saved: message.id, error: undefined };
  }
}

function Main() {
  const [state, setState] = useState(initialState);

  const send = useCallback((message: SettingsWebToHost) => {
    vscode.postMessage(message);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent<SettingsHostToWeb>) => {
      if (event.data.kind === "settings") {
        setLocale(resolveLocale(event.data.locale ?? "en"));
      }
      setState((previous) => reducer(previous, event.data));
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ kind: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  // The "saved" marker is a moment of feedback, not a state to keep around.
  useEffect(() => {
    if (!state.saved) {
      return;
    }
    const timer = setTimeout(() => setState((previous) => ({ ...previous, saved: undefined })), 2000);
    return () => clearTimeout(timer);
  }, [state.saved]);

  return <SettingsPanel {...state} send={send} />;
}

// The stylesheet is inlined into the page by the host (dist/webview.css),
// so this bundle does not import it.
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Main />);
}
