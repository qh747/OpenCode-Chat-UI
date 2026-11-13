import { useEffect, useMemo, useRef } from "react";
import type { ChatState } from "./state";
import type { WebToHost } from "../src/webview/protocol";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { DiffList, PermissionCard, Welcome } from "./Cards";
import type { ComposerHandle } from "./composerTypes";
import type { ModelInfo } from "../src/opencode/types";

interface Props {
  state: ChatState;
  send: (message: WebToHost) => void;
  composerHandleRef: React.MutableRefObject<ComposerHandle | undefined>;
}

export function App({ state, send, composerHandleRef }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const consumedPicks = useRef(new Set<string>());

  // Feed file-picker results into composer chips.
  useEffect(() => {
    for (const [requestId, paths] of Object.entries(state.pickedPaths)) {
      if (!consumedPicks.current.has(requestId)) {
        consumedPicks.current.add(requestId);
        composerHandleRef.current?.setChips(paths);
      }
    }
  }, [state.pickedPaths, composerHandleRef]);

  // Auto-scroll while streaming (only if the user is near the bottom).
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [state.messages, state.busy, state.diffs, state.pending]);

  const hasMessages = state.messages.some((m) => m.type === "user" || m.type === "assistant");

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of state.catalog.models) {
      const list = groups.get(model.providerID) ?? [];
      list.push(model);
      groups.set(model.providerID, list);
    }
    return [...groups.entries()];
  }, [state.catalog.models]);

  const activeModel = state.model ?? state.catalog.defaultModel;
  const agent = state.agent ?? state.catalog.agents[0]?.id;

  return (
    <div className="app">
      <div className="header">
        <span className="header-title" title={state.title}>
          {state.title ?? "New session"}
        </span>
        <span className="spacer" />
        {state.catalog.agents.length > 0 && (
          <select
            className="picker"
            value={agent ?? ""}
            onChange={(event) => send({ kind: "setAgent", agent: event.target.value })}
            title="Agent (Shift+Tab cycles)"
          >
            {state.catalog.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        {modelGroups.length > 0 && (
          <select
            className="picker"
            value={activeModel ? `${activeModel.providerID}/${activeModel.id}` : ""}
            onChange={(event) => {
              const [providerID, id] = event.target.value.split("/");
              if (providerID && id) {
                send({ kind: "setModel", providerID, id });
              }
            }}
            title="Model"
          >
            {modelGroups.map(([providerID, models]) => (
              <optgroup key={providerID} label={providerID}>
                {models.map((m) => (
                  <option key={`${m.providerID}/${m.modelID}`} value={`${m.providerID}/${m.modelID}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <button className="icon-btn" onClick={() => send({ kind: "newSession" })} title="New session">
          ＋
        </button>
      </div>

      {state.connection === "starting" && (
        <div className="banner info">Starting opencode server…</div>
      )}
      {state.connection === "error" && (
        <div className="banner error">
          <span>{state.connectionError ?? "opencode server is not running."}</span>
          <span className="banner-buttons">
            <button className="btn small" onClick={() => send({ kind: "restartServer" })}>
              Retry
            </button>
            <button className="btn small" onClick={() => send({ kind: "showLogs" })}>
              Show logs
            </button>
          </span>
        </div>
      )}

      {!hasMessages && state.connection !== "error" ? (
        <Welcome version={state.version} />
      ) : (
        <div
          className="scroll-area"
          ref={listRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          <MessageList messages={state.messages} busy={state.busy} onRetry={() => undefined} />
        </div>
      )}

      {hasMessages && state.pending.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          onReply={(requestID, decision) => send({ kind: "permissionReply", requestID, decision })}
        />
      ))}

      {hasMessages && (
        <DiffList
          diffs={state.diffs}
          onOpen={(file) => send({ kind: "openDiff", file })}
          onKeep={(file) => send({ kind: "keepFile", file })}
          onRevert={(file) => send({ kind: "revertFile", file })}
        />
      )}

      {agent === "plan" && !state.busy && hasMessages && (
        <button className="btn plan-execute" onClick={() => send({ kind: "executePlan" })}>
          ▶ Proceed with the plan in build mode
        </button>
      )}

      <Composer
        dispatch={send}
        busy={state.busy}
        canSend={state.connection === "connected"}
        agent={agent}
        fileResults={state.fileResults}
        onAbort={() => send({ kind: "abort" })}
        handleRef={(handle) => {
          composerHandleRef.current = handle;
        }}
      />

      {state.errors.map((error, index) => (
        <div key={index} className="banner error small-banner">
          {error}
        </div>
      ))}
    </div>
  );
}
