import { useEffect, useRef, useState } from "react";
import type { ChatState } from "./state";
import type { WebToHost } from "../src/webview/protocol";
import { t } from "../src/util/i18n";
import { MessageList, ConversationErrors } from "./MessageList";
import { Composer } from "./Composer";
import { DiffList, PermissionCard, Welcome } from "./Cards";
import { Dropdown } from "./Dropdown";
import { ModelPicker } from "./ModelPicker";
import { HistoryMenu } from "./HistoryMenu";
import { QueueStrip } from "./QueueStrip";
import { QuestionForm } from "./QuestionForm";
import { SubagentStrip } from "./SubagentStrip";
import { SessionInfo } from "./SessionInfo";
import type { ComposerHandle } from "./composerTypes";

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
  /** 未消费 staged 图的首次出现时间，用于 30s 超时放弃。 */
  const imageSeenAt = useRef(new Map<string, number>());

  // Feed file-picker results into composer chips.
  useEffect(() => {
    for (const [requestId, paths] of Object.entries(state.pickedPaths)) {
      if (!consumedPicks.current.has(requestId)) {
        consumedPicks.current.add(requestId);
        composerHandleRef.current?.setChips(paths.map((path) => ({ path, kind: "file" })));
      }
    }
  }, [state.pickedPaths, composerHandleRef]);

  // Feed staged paste/drop images into composer chips.
  // 未消费不丢弃（spec 分支 9）：composer 尚未挂载时先不标记，由重试间隔
  // 每秒再投，直到被消费或超过 30s 放弃（宿主内存仍会在发送/丢弃时清理）。
  useEffect(() => {
    const pending = Object.entries(state.stagedImages).filter(
      ([requestId]) => !consumedImages.current.has(requestId),
    );
    if (pending.length === 0) {
      return;
    }
    const deliver = (requestId: string, image: { path: string; name: string }) => {
      if (!composerHandleRef.current || consumedImages.current.has(requestId)) {
        return false;
      }
      composerHandleRef.current.setChips([{ path: image.path, name: image.name, kind: "image" }]);
      consumedImages.current.add(requestId);
      imageSeenAt.current.delete(requestId);
      return true;
    };
    for (const requestId of pending.map(([requestId]) => requestId)) {
      if (!imageSeenAt.current.has(requestId)) {
        imageSeenAt.current.set(requestId, Date.now());
      }
    }
    for (const [requestId, image] of pending) {
      deliver(requestId, image);
    }
    if (pending.every(([requestId]) => consumedImages.current.has(requestId))) {
      return;
    }
    const timer = setInterval(() => {
      for (const [requestId, image] of Object.entries(state.stagedImages)) {
        if (consumedImages.current.has(requestId)) {
          continue;
        }
        const seen = imageSeenAt.current.get(requestId) ?? Date.now();
        if (Date.now() - seen > 30_000) {
          // 超时放弃：不再重试，避免陈旧条目无限重投。
          consumedImages.current.add(requestId);
          imageSeenAt.current.delete(requestId);
          continue;
        }
        deliver(requestId, image);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [state.stagedImages, composerHandleRef]);

  // Auto-scroll while streaming (only if the user is near the bottom).
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [state.messages, state.busy, state.diffs, state.pending, state.errors]);

  const hasMessages = state.messages.some((m) => m.type === "user" || m.type === "assistant");

  // New content does not always arrive through React state (an expanded card,
  // a late image, a font reflow), so keep following the bottom while it grows.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !hasMessages) {
      return;
    }
    const target = list.querySelector(".message-list") ?? list;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) {
        list.scrollTop = list.scrollHeight;
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMessages]);

  const activeModel = state.model ?? state.catalog.defaultModel;
  // Never show a placeholder for the mode: default to build until known.
  const agent = state.agent ?? state.catalog.agents[0]?.id ?? "build";
  const activeModelInfo = activeModel
    ? state.catalog.models.find(
        (m) => m.providerID === activeModel.providerID && m.modelID === activeModel.id,
      )
    : undefined;
  const variants = activeModelInfo?.variants ?? [];

  const agentWeight = (id: string): number => (id === "build" ? 0 : id === "plan" ? 1 : 2);
  const capitalizeLabel = (id: string): string => (id ? `${id.charAt(0).toUpperCase()}${id.slice(1)}` : id);
  const agentOptions =
    state.catalog.agents.length > 0
      ? [...state.catalog.agents]
          .sort((a, b) => agentWeight(a.id) - agentWeight(b.id))
          .map((a) => ({ value: a.id, label: a.name }))
      : [
          {
            value: agent ?? "build",
            label: capitalizeLabel(agent ?? "build"),
          },
        ];
  const effortOptions = [
    { value: "", label: t("effortDefault") },
    ...variants.map((v) => ({ value: v.id, label: v.id ? `${v.id.charAt(0).toUpperCase()}${v.id.slice(1)}` : v.id })),
  ];
  const [effortOpen, setEffortOpen] = useState(false);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);

  // The first snapshot carries everything the panel needs — catalog, title,
  // git, messages — while the state/catalog messages before it describe only
  // part of the screen. Painting those would show a half-built panel that then
  // pops in piece by piece, so hold the very first paint until it lands. On a
  // connection error the banner is the point, so show it right away.
  if (!state.hydrated && state.connection !== "error") {
    return null;
  }

  // The connection reports "connected" before the catalog is posted, so gating
  // each picker on its own data makes them pop in one at a time. They all read
  // from the same catalog, so waiting for it renders the whole row — mode,
  // model and effort — in a single commit.
  const catalogReady = state.connection === "connected" && state.catalogLoaded;

  const pickers = catalogReady ? (
    <>
      <Dropdown
        value={agent ?? ""}
        options={agentOptions}
        onChange={(value) => send({ kind: "setAgent", agent: value })}
        title={t("agentPickerTitle")}
        className="agent-picker"
      />
      <ModelPicker
        models={state.catalog.models}
        recentModels={state.catalog.recentModels}
        activeModel={activeModel}
        onSelect={(ref) => send({ kind: "setModel", providerID: ref.providerID, id: ref.id, variant: ref.variant })}
      />
      {variants.length > 0 && activeModel && (
        <span className={`effort-wrap${effortOpen ? " open" : ""}`}>
          <Dropdown
            value={variants.some((v) => v.id === state.model?.variant) ? (state.model?.variant ?? "") : ""}
            options={effortOptions}
            onChange={(value) =>
              send({
                kind: "setModel",
                providerID: activeModel.providerID,
                id: activeModel.id,
                variant: value || undefined,
              })
            }
            onOpenChange={setEffortOpen}
            title={t("effortPickerTitle")}
          />
        </span>
      )}
    </>
  ) : null;

  return (
    <div className="app">
      <div className="header">
        <svg
          className="header-mark"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <rect x="1.75" y="1.75" width="20.5" height="20.5" rx="6" />
          <g transform="translate(4.5 4.5) scale(0.625)" strokeWidth="2.72">
            <rect x="3.2" y="3.2" width="17.6" height="17.6" />
            <rect x="8" y="8" width="8" height="8" />
          </g>
        </svg>
        <span className="header-title" title={state.title}>
          {state.title ?? t("newSession")}
        </span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => send({ kind: "openSettings" })} title={t("settingsTitle")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          </svg>
        </button>
        <HistoryMenu
          dispatch={send}
          groups={state.historyGroups}
          currentSessionId={state.sessionID}
          onOpen={() => send({ kind: "showHistory" })}
        />
        <button className="icon-btn" onClick={() => send({ kind: "newSession" })} title={t("newSession")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {state.connection === "starting" && (
        <div className="banner info">{t("startingServer")}</div>
      )}
      {state.connection === "connected" && state.compatWarning && (
        <div className="banner warn">{state.compatWarning}</div>
      )}
      {state.connection === "error" && (
        <div className="banner error">
          <span>{state.connectionError ?? t("serverNotRunning")}</span>
          <span className="banner-buttons">
            <button className="btn small" onClick={() => send({ kind: "restartServer" })}>
              {t("retry")}
            </button>
            <button className="btn small" onClick={() => send({ kind: "showLogs" })}>
              {t("showLogs")}
            </button>
          </span>
        </div>
      )}

      <div
        className="scroll-area"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!hasMessages && state.connection !== "error" ? (
          <Welcome version={state.version} />
        ) : (
          <MessageList
            messages={state.messages}
            busy={state.busy}
            onRewind={(messageID) => send({ kind: "rewindTo", messageID })}
            onOpenUrl={(url) => send({ kind: "openUrl", url })}
            onOpenFile={(path, start, end) => send({ kind: "openFile", path, start, end })}
            onCopyCode={(text) => send({ kind: "copyCode", text })}
          />
        )}
        <ConversationErrors errors={state.errors} />
      </div>

      {hasMessages && state.pending.map((request) => (
        <PermissionCard
          key={request.id}
          request={request}
          onReply={(requestID, decision) => send({ kind: "permissionReply", requestID, decision })}
        />
      ))}

      {hasMessages && state.forms.map((form) => (
        <QuestionForm
          key={form.id}
          form={form}
          onReply={(formID, answer) => send({ kind: "formReply", formID, answer })}
          onCancel={(formID) => send({ kind: "formCancel", formID })}
        />
      ))}

      {hasMessages && (
        <DiffList
          diffs={state.diffs}
          maxVisibleRows={state.maxVisibleDiffRows}
          onOpen={(file) => send({ kind: "openDiff", file })}
          onRevert={(file) => send({ kind: "revertFile", file })}
        />
      )}

      <SubagentStrip
        jobs={state.subagents}
        onStop={(childSessionID) => send({ kind: "stopSubagent", childSessionID })}
      />

      {!state.isSubagentSession && (
        <QueueStrip
          queue={state.queue}
          paused={state.queuePaused}
          sessionID={state.sessionID}
          onForce={(id) => send({ kind: "forceQueued", id })}
          onRemove={(id) => send({ kind: "removeQueued", id })}
          onResume={() => send({ kind: "resumeQueue" })}
        />
      )}

      {/* Composer 始终挂载、仅隐藏（issue 12）：查看子代理会话时若卸载组件，
          主会话的草稿/已上传图片等局部状态会全部丢失。 */}
      <div className={`composer-slot${state.isSubagentSession ? " is-hidden" : ""}`}>
      <Composer
        dispatch={send}
        busy={state.busy}
        canSend={state.connection === "connected"}
        submitKey={state.submitKey}
        sessionID={state.sessionID}
        context={
          state.showContextBar
            ? {
                git: state.git,
                workspacePath: state.workspacePath,
                contextTokens: state.contextTokens,
                cacheHitRate: state.cacheHitRate,
                contextLimit: activeModelInfo?.limit?.context,
                onSessionInfo: () => setSessionInfoOpen(true),
                onOpenSourceControl: () => send({ kind: "openSourceControl" }),
                onRevealInExplorer: () => {
                  if (state.workspacePath) {
                    send({ kind: "revealInExplorer", path: state.workspacePath });
                  }
                },
              }
            : undefined
        }
        pickers={pickers}
        queuedCount={state.queue.length}
        fileResults={state.fileResults}
        commands={state.catalog.commands}
        skills={state.catalog.skills}
        editors={state.editors}
        previews={state.previews}
        onRunCommand={(command, args) => send({ kind: "runCommand", command, arguments: args })}
        onAbort={() => send({ kind: "abort" })}
        handleRef={(handle) => {
          composerHandleRef.current = handle;
        }}
      />
      </div>
      <SessionInfo
        open={sessionInfoOpen}
        onClose={() => setSessionInfoOpen(false)}
        title={state.title}
        providerID={activeModelInfo?.providerID ?? activeModel?.providerID}
        modelName={activeModelInfo?.name ?? activeModel?.id}
        contextLimit={activeModelInfo?.limit?.context}
        created={state.created}
        updated={state.updated}
        cost={state.cost}
        contextTokens={state.contextTokens}
        messages={state.messages}
        onExport={() => {
          if (state.sessionID) {
            send({ kind: "exportSession", id: state.sessionID });
          }
        }}
      />
    </div>
  );
}
