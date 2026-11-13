import { useEffect, useMemo, useRef } from "react";
import type { ChatState } from "./state";
import type { WebToHost } from "../src/webview/protocol";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { DiffList, PermissionCard, Welcome } from "./Cards";
import { Dropdown } from "./Dropdown";
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
  const consumedImages = useRef(new Set<string>());

  // Feed file-picker results into composer chips.
  useEffect(() => {
    for (const [requestId, paths] of Object.entries(state.pickedPaths)) {
      if (!consumedPicks.current.has(requestId)) {
        consumedPicks.current.add(requestId);
        composerHandleRef.current?.setChips(paths.map((path) => ({ path })));
      }
    }
  }, [state.pickedPaths, composerHandleRef]);

  // Feed staged paste/drop images into composer chips.
  useEffect(() => {
    for (const [requestId, image] of Object.entries(state.stagedImages)) {
      if (!consumedImages.current.has(requestId)) {
        consumedImages.current.add(requestId);
        composerHandleRef.current?.setChips([{ path: image.path, name: image.name, image: true }]);
      }
    }
  }, [state.stagedImages, composerHandleRef]);

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
  const activeModelInfo = activeModel
    ? state.catalog.models.find(
        (m) => m.providerID === activeModel.providerID && m.modelID === activeModel.id,
      )
    : undefined;
  const variants = activeModelInfo?.variants ?? [];

  const agentOptions =
    state.catalog.agents.length > 0
      ? state.catalog.agents.map((a) => ({ value: a.id, label: a.name }))
      : [{ value: agent ?? "build", label: agent ?? "build" }];
  const modelOptions = modelGroups.flatMap(([providerID, models]) =>
    models.map((m) => ({ value: `${m.providerID}/${m.modelID}`, label: m.name, group: providerID })),
  );
  const effortOptions = [
    { value: "", label: "effort: default" },
    ...variants.map((v) => ({ value: v.id, label: `effort: ${v.id}` })),
  ];

  const pickers =
    state.connection === "connected" ? (
      <>
        <Dropdown
          value={agent ?? ""}
          options={agentOptions}
          onChange={(value) => send({ kind: "setAgent", agent: value })}
          title="Agent (Shift+Tab cycles)"
        />
        {modelOptions.length > 0 && (
          <Dropdown
            wide
            value={activeModel ? `${activeModel.providerID}/${activeModel.id}` : ""}
            options={modelOptions}
            onChange={(value) => {
              const [providerID, id] = value.split("/");
              if (providerID && id) {
                send({ kind: "setModel", providerID, id, variant: undefined });
              }
            }}
            title={activeModelInfo?.name ?? "Model"}
            placeholder="Model"
          />
        )}
        {variants.length > 0 && activeModel && (
          <Dropdown
            value={state.model?.variant ?? ""}
            options={effortOptions}
            onChange={(value) =>
              send({
                kind: "setModel",
                providerID: activeModel.providerID,
                id: activeModel.id,
                variant: value || undefined,
              })
            }
            title="Reasoning effort"
          />
        )}
      </>
    ) : null;

  return (
    <div className="app">
      <div className="header">
        <span className="header-title" title={state.title}>
          {state.title ?? "New session"}
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => send({ kind: "showHistory" })} title="Session history">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v5l3.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button className="icon-btn" onClick={() => send({ kind: "newSession" })} title="New session">
          ＋
        </button>
      </div>

      {state.connection === "starting" && (
        <div className="banner info">Starting opencode server…</div>
      )}
      {state.connection === "connected" && state.compatWarning && (
        <div className="banner warn">{state.compatWarning}</div>
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
          <MessageList
          messages={state.messages}
          busy={state.busy}
          onRewind={(messageID) => send({ kind: "rewindTo", messageID })}
        />
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
        pickers={pickers}
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
