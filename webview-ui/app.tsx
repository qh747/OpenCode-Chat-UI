import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatState } from "./state";
import type { WebToHost } from "../src/webview/protocol";
import { t } from "../src/util/i18n";
import { prependDelta, shouldRequestEarlier } from "./earlier";
import { isAtBottom, updateJumpWheel, type JumpWheelDecision } from "./jump-bottom";
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
  /**
   * 程序化滚动标记（钉底、回填前插的锚点校正）：滚动事件由它们触发的
   * 不算用户操作，不能拿去更新「用户在顶部」的状态。
   */
  const programmaticScroll = useRef(false);
  /** 用户最后一次真实滚动位置的 scrollTop；未滚动过为 undefined。 */
  const lastUserScroll = useRef<number | undefined>(undefined);
  /** 「回到底部」胶囊：滚轮累计（ref,不触发渲染）与显示状态（state）。 */
  const jumpWheel = useRef<JumpWheelDecision>({ delta: 0, show: false });
  const [jumpDown, setJumpDown] = useState(false);
  /** 上一次渲染的列表度量：用于识别「更早消息被前插」。 */
  const listMetrics = useRef<{ firstId: string | undefined; height: number }>({
    firstId: undefined,
    height: 0,
  });

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
      programmaticScroll.current = true;
      list.scrollTop = list.scrollHeight;
    }
  }, [state.messages, state.busy, state.diffs, state.pending, state.errors]);

  // Prepended older pages must not move the viewport (acceptance 4): shift
  // scrollTop by the height the prepend added. The shift is programmatic, so
  // the scroll handler ignores it and the load-earlier chain stays alive.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const prev = listMetrics.current;
    const firstId = state.messages[0]?.id;
    const delta = prependDelta(state.messages, prev.firstId, prev.height, list.scrollHeight);
    if (delta > 0 && !stickToBottom.current) {
      programmaticScroll.current = true;
      list.scrollTop += delta;
    }
    listMetrics.current = { firstId, height: list.scrollHeight };
  }, [state.messages]);

  // While the user's last genuine scroll kept them near the top, keep asking
  // for older pages until the history closes (acceptance 1).
  useEffect(() => {
    if (
      shouldRequestEarlier({
        hasEarlier: state.hasEarlier,
        loadingEarlier: state.loadingEarlier,
        lastUserScrollTop: lastUserScroll.current,
      })
    ) {
      send({ kind: "loadEarlier" });
    }
  }, [state.messages, state.hasEarlier, state.loadingEarlier, send]);

  // 会话切换：胶囊隐没、滚轮累计清零,不带入下一个会话。
  useEffect(() => {
    jumpWheel.current = { delta: 0, show: false };
    setJumpDown(false);
  }, [state.sessionID]);

  const hasMessages = state.messages.some((m) => m.type === "user" || m.type === "assistant");
  // 子代理视图（GLOSSARY「Subagent view」）：三条列表的显示规则共用这一个
  // 判定——评审收敛（Duplicated Code），规则只表达一次。
  const inSubagentView = state.isSubagentSession;

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
        programmaticScroll.current = true;
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

  // 加载层（spec 分支 7，变体 C）：面板从第一帧就渲染，但就绪前整体置灰不可
  // 点，顶部一条不定进度条；就绪后进度条走满淡出、解除置灰。就绪判据：已连
  // 接 + 首快照已应用 + 模型列表非空 + 模型引用可解析——目录竞态会让首个快照
  // 携带空 catalog（宿主在 server 注册表就绪前拉取，见 src/host.ts 的注释），
  // 旧的两道门（hydrated/catalogLoaded）放行后模型名会以兜底「模型」上屏、思
  // 考深度缺失。10s 超时兜底放行，坏服务器不得把用户锁死在加载层；连接报错
  // 立即绕过（横幅才是重点）。
  const modelsReady = state.catalog.models.length > 0;
  // 「可解析」按 spec 字面：引用不仅存在，还要能在 models 里解析出名字
  // （解析不到时 ModelPicker 会以裸 id 上屏）；极端形态靠 10s 兜底放行。
  const modelRef = state.model ?? state.catalog.defaultModel;
  const modelRefReady =
    !!modelRef &&
    state.catalog.models.some((m) => m.providerID === modelRef.providerID && m.modelID === modelRef.id);
  const bootReady =
    state.connection === "connected" && state.hydrated && modelsReady && modelRefReady;
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    // 10s 兜底对 starting 与 connected 一视同仁：坏服务器不得把用户锁死在
    // 加载层（报错另有立即绕过）；连接状态翻转会重开一轮窗口。
    if (state.connection === "error" || bootReady) {
      setBootTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setBootTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [state.connection, bootReady]);
  const booted = state.connection === "error" || bootReady || bootTimedOut;
  const booting = !booted;

  // 进度条：加载中不定滑动；揭示后走满并淡出，随后卸载；报错不显示（渲染
  // 条件而非 effect，静态渲染/首帧即正确）。
  const [barGone, setBarGone] = useState(false);
  useEffect(() => {
    if (booting) {
      setBarGone(false);
      return;
    }
    // 900ms 覆盖 styles.css 里 .boot-bar.done 的过渡（0.3s 走满 + 0.35s 延迟
    // 后 0.45s 淡出，总计 ~0.8s）；两处是耦合常量，改一处需同步另一处。
    const timer = setTimeout(() => setBarGone(true), 900);
    return () => clearTimeout(timer);
  }, [booting]);

  // The connection reports "connected" before the catalog is posted, so gating
  // each picker on its own data makes them pop in one at a time. They all read
  // from the same catalog, so waiting for it renders the whole row — mode,
  // model and effort — in a single commit. 加载层置灰期间不渲染药丸：防止空
  // catalog 上屏时「模型」兜底字样闪现；超时兜底放行后才按现状降级显示。
  const catalogReady = state.connection === "connected" && state.catalogLoaded;

  // 返回按钮的目标（subagent-nav）：只在子代理会话里提供；本地 const
  // 让 JSX 闭包里的窄化成立，也避免在渲染中途读到漂移的 state。
  const parentSessionID = state.isSubagentSession ? state.parentSessionID : undefined;

  const pickers = catalogReady && booted ? (
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
    <div className={`app${booting ? " booting" : ""}`}>
      {!barGone && state.connection !== "error" && (
        <div className={`boot-bar${booting ? "" : " done"}`} aria-hidden="true" />
      )}
      <div className="header">
        {/* 子代理视图：装饰 logo 让位给返回按钮（Q7）——左上角、icon-btn
            同规格，不加行高；点击走与历史菜单相同的 switchSession（Q1）。 */}
        {parentSessionID ? (
          <button
            type="button"
            className="icon-btn header-back"
            onClick={() => send({ kind: "switchSession", id: parentSessionID })}
            title={t("backToParent")}
            aria-label={t("backToParent")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m15 18-6-6 6-6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
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
        )}
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
          /* 高亮折算（spec D3）：子会话在屏时高亮其直接父级的行；深层嵌套
             父级非根时无行可匹配，自然退化。 */
          currentSessionId={state.isSubagentSession ? state.parentSessionID : state.sessionID}
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
          // 程序化滚动（钉底、锚点校正）不是用户操作：不更新顶部跟随状态。
          if (programmaticScroll.current) {
            programmaticScroll.current = false;
            return;
          }
          const el = event.currentTarget;
          stickToBottom.current = isAtBottom(el);
          lastUserScroll.current = el.scrollTop;
          if (stickToBottom.current) {
            // 到底即隐没胶囊并清零滚轮累计：重现需要重新滚满两格（jump-bottom）。
            jumpWheel.current = { delta: 0, show: false };
            setJumpDown(false);
          }
          if (
            shouldRequestEarlier({
              hasEarlier: state.hasEarlier,
              loadingEarlier: state.loadingEarlier,
              lastUserScrollTop: el.scrollTop,
            })
          ) {
            send({ kind: "loadEarlier" });
          }
        }}
        onWheel={(event) => {
          // 滚轮是用户操作：向下累计,满两格当量显示胶囊;向上滚清零累计;
          // 已在底部不计数且直接隐没（规则见 jump-bottom 的纯函数）。
          const next = updateJumpWheel(
            jumpWheel.current,
            event.deltaY,
            isAtBottom(event.currentTarget),
          );
          jumpWheel.current = next;
          setJumpDown(next.show);
        }}
      >
        {!hasMessages && state.connection !== "error" ? (
          <Welcome version={state.version} />
        ) : (
          <MessageList
            messages={state.messages}
            busy={state.busy}
            hasEarlier={state.hasEarlier}
            loadingEarlier={state.loadingEarlier}
            onRewind={(messageID) => send({ kind: "rewindTo", messageID })}
            onOpenUrl={(url) => send({ kind: "openUrl", url })}
            onOpenFile={(path, start, end) => send({ kind: "openFile", path, start, end })}
            onCopyCode={(text) => send({ kind: "copyCode", text })}
          />
        )}
        <ConversationErrors errors={state.errors} />
        {jumpDown && hasMessages && (
          <button
            type="button"
            className="jump-bottom"
            onClick={() => {
              const list = listRef.current;
              if (list) {
                programmaticScroll.current = true;
                list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
              }
              jumpWheel.current = { delta: 0, show: false };
              setJumpDown(false);
            }}
            aria-label={t("jumpToLatest")}
            title={t("jumpToLatest")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path
                d="m19 12-7 7-7-7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
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

      {/* 工票01（opencode-sidebar）：子代理视图三条列表结构性不渲染——
          有数据也不渲染（Q2）；主会话视图不变。改动列表连数据都不拉
          （host 侧 refreshDiffs 同步早退，Q1c）。 */}
      {!inSubagentView && hasMessages && (
        <DiffList
          diffs={state.diffs}
          maxVisibleRows={state.maxVisibleDiffRows}
          onOpen={(file) => send({ kind: "openDiff", file })}
          onRevert={(file) => send({ kind: "revertFile", file })}
        />
      )}

      {!inSubagentView && (
        <SubagentStrip
          jobs={state.subagents}
          currentSessionId={state.sessionID}
          onOpen={(childSessionID) => send({ kind: "switchSession", id: childSessionID })}
          onStop={(childSessionID) => send({ kind: "stopSubagent", childSessionID })}
        />
      )}

      {!inSubagentView && (
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
