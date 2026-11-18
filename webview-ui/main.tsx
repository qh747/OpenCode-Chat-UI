import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { initialState, reducer } from "./state";
import { resolveLocale, setLocale } from "../src/util/i18n";
import { stampSession } from "../src/webview/protocol";
import type { HostToWeb, WebToHost } from "../src/webview/protocol";
import type { ComposerHandle } from "./composerTypes";
import "./styles.css";

interface VsCodeApi {
  postMessage(message: WebToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function Main() {
  const [state, setState] = useState(initialState);
  const composerHandleRef = useRef<ComposerHandle | undefined>(undefined);
  const pendingDeltas = useRef<HostToWeb[]>([]);
  const frame = useRef<number | undefined>(undefined);
  /** 发送时正在看的会话：动作消息据此盖章（spec 分支 4b）。 */
  const sessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    sessionRef.current = state.sessionID;
  }, [state.sessionID]);

  const send = useCallback((message: WebToHost) => {
    vscode.postMessage(stampSession(message, sessionRef.current));
  }, []);

  // Stream deltas arrive faster than the panel can paint, so fold them into one
  // dispatch per frame. Every other message flushes first: a full message list
  // must never be overwritten by a delta that was already delivered.
  const flushDeltas = useCallback(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    const batch = pendingDeltas.current.splice(0);
    if (batch.length > 0) {
      setState((previous) => batch.reduce(reducer, previous));
    }
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWeb>) => {
      const message = event.data;
      if (message.kind === "state" || message.kind === "snapshot") {
        const locale = message.kind === "state" ? message.locale : message.snapshot.locale;
        if (locale) {
          setLocale(resolveLocale(locale));
        }
      }
      if (message.kind === "textDelta" || message.kind === "reasoningDelta") {
        pendingDeltas.current.push(message);
        if (frame.current === undefined) {
          frame.current = requestAnimationFrame(flushDeltas);
        }
        return;
      }
      flushDeltas();
      setState((previous) => reducer(previous, message));
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ kind: "ready" });
    return () => {
      window.removeEventListener("message", listener);
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, [flushDeltas]);

  // Tell the host whether the user is looking at the chat: a completion
  // notice is only worth showing when nobody is.
  useEffect(() => {
    const onFocus = () => vscode.postMessage({ kind: "focusChanged", focused: true });
    const onBlur = () => vscode.postMessage({ kind: "focusChanged", focused: false });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) {
      vscode.postMessage({ kind: "focusChanged", focused: true });
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
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
