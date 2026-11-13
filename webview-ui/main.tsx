import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { initialState, reducer } from "./state";
import type { HostToWeb, WebToHost } from "../src/webview/protocol";
import type { ComposerHandle } from "./composerTypes";
import "./styles.css";

interface VsCodeApi {
  postMessage(message: WebToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function Main() {
  const [state, reduce] = useReducer(reducer, initialState);
  const composerHandleRef = useRef<ComposerHandle | undefined>(undefined);

  const send = useCallback((message: WebToHost) => {
    vscode.postMessage(message);
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWeb>) => {
      reduce(event.data);
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ kind: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const content = useMemo(
    () => <App state={state} send={send} composerHandleRef={composerHandleRef} />,
    [state, send],
  );
  return content;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Main />);
}
