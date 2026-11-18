import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { OpencodeHost } from "../host";
import { toServerPath } from "../host";
import type {
  AssistantContent,
  AssistantMessage,
  FileDiffInfo,
  FormAnswerValue,
  FormInfo,
  MessageInfo,
  PermissionRequest,
  PromptFileAttachment,
  UserMessage,
} from "../opencode/types";
import { promptAttachment, rangeAttachment, type StagedImage } from "../util/attachments";
import { appendLinks } from "../util/message-attachments";
import { getLocale, t, type MessageKey } from "../util/i18n";
import { reverseApply } from "../util/diffapply";
import { LiveStream, mergeLiveContent, type SegmentKind } from "../util/live-segments";
import { orderMessages } from "../util/messages";
import { stripTrailingMarkers } from "../util/dcp-markers";
import { cacheHitRateOf, contextTokensOf } from "../util/tokens";
import { toSubagentJobs, type SubagentJob } from "../util/subagents";
import { resolveCommandAction, findSkillByCommand } from "../util/commands";
import { diffFileKey, diffRange, attributionSet } from "../util/session-diff";
import {
  deriveSessionStatus,
  foldSubagentSessions,
  groupFoldedByDate,
} from "../util/sessions";
import type { HistoryRow } from "../util/sessions";
import { GitStatusProvider } from "../git";
import type { OpencodeClient } from "../opencode/client";
import { SessionQueues } from "./session-queues";
import { SessionDismissed } from "./session-dismissed";
import type { QueueSnapshot } from "./session-queues";
import { isStaleAction } from "./protocol";
import type {
  AttachmentRef,
  EditorFile,
  GitInfo,
  HostToWeb,
  QueuedMessage,
  WebToHost,
} from "./protocol";

interface Sink {
  post(message: HostToWeb): void;
  /** True while the webview holds keyboard focus. */
  focused: boolean;
}

const SCHEME = "opencode-diff-before";

/**
 * Chat controller: one per window, driving any number of webview surfaces
 * (the chat view and/or standalone editor tabs) with the same state.
 */
export class ChatController implements vscode.Disposable {
  private readonly sinks = new Set<Sink>();
  private sessionId: string | undefined;
  private messages: MessageInfo[] = [];
  /** Streaming text/reasoning of the current turn, per assistant message. */
  private liveStreams = new Map<string, LiveStream>();
  /** Authoritative content pushed by `session.message.content.updated`. */
  private liveContent = new Map<string, AssistantContent[]>();
  /** Deltas waiting for the flush timer, so a burst becomes one post. */
  private pendingDeltas: Array<{
    sessionID: string;
    messageID: string;
    kind: SegmentKind;
    ordinal: number;
    delta: string;
  }> = [];
  private deltaTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: PermissionRequest[] = [];
  /** Pending session forms (the `question` tool); non-empty blocks the turn. */
  private forms: FormInfo[] = [];
  private diffs: FileDiffInfo[] = [];
  /** Token of the latest diff poll; older responses are dropped, not applied. */
  private diffRequest = 0;
  /**
   * Ordered server messages used to build a session-wide diff range. Seeded by
   * `refreshMessages`, refreshed by `refreshDiffs` when stale.
   */
  private turnCache: { sessionID: string; messages: MessageInfo[]; at: number } | undefined;
  /** Per-session queues, so switching through history does not drop messages. */
  private readonly sessionQueues = new SessionQueues();
  /** Per-session dismissed rows, so switching through history does not resurrect them. */
  private readonly sessionDismissed = new SessionDismissed();
  /**
   * Files the user chose not to see in this session, keyed by `diffFileKey` of
   * the diff they dismissed. A file whose diff has changed since comes back:
   * the agent editing it again is news, even if the user already kept an
   * earlier round of it. The map is parked per session on a switch
   * (`SessionDismissed`), so returning to a session restores its memory.
   */
  private dismissed = new Map<string, string>();
  private busy = false;
  /** Set when the running turn failed, so the completion notice stays quiet. */
  private turnFailed = false;
  /** Messages held until the running turn finishes. */
  private queue: QueuedMessage[] = [];
  /** Held after a stop/failure until the user explicitly resumes. */
  private queuePaused = false;
  /** A forced message waiting for the interrupted turn to actually end. */
  private pendingForce: QueuedMessage | undefined;
  private title: string | undefined;
  private agent: string | undefined;
  private model: { providerID: string; id: string; variant?: string } | undefined;
  /** Choices made before a session exists; applied when it is created. */
  private pendingAgent: string | undefined;
  private pendingModel: { providerID: string; id: string; variant?: string } | undefined;
  /** Cache hit rate of the latest billed assistant message (0..1). */
  private cacheHitRate: number | undefined;
  /** Context-window occupancy: tokens of the latest billed assistant message. */
  private contextTokens: number | undefined;
  /** Revert point reported by the server, when the session has been rewound. */
  private revertMessageID: string | undefined;
  private git: GitInfo = {};
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private metaRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private permissionTimer: ReturnType<typeof setInterval> | undefined;
  /** Subagents running under the current turn (polled; the server has no events). */
  private subagents: SubagentJob[] = [];
  /** True when the open session is a subagent's child session. */
  private isSubagentSession = false;
  private subagentTimer: ReturnType<typeof setInterval> | undefined;
  /** Token of the latest subagent poll; a stale response must not cross sessions. */
  private subagentRequest = 0;
  private fileCache: { path: string; name: string }[] | undefined;
  /** Images staged by the composer, keyed by the reference sent back to the webview. */
  private readonly stagedImages = new Map<string, StagedImage>();
  /** Open editor tabs, refreshed whenever the selection or the tabs change. */
  private editors: EditorFile[] = [];
  private readonly beforeDocs = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly host: OpencodeHost,
    private readonly context: vscode.ExtensionContext,
    private readonly folder: vscode.WorkspaceFolder,
    private readonly output?: vscode.OutputChannel,
  ) {
    this.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent: (uri) => this.beforeDocs.get(uri.fragment) ?? "",
      }),
    );
    this.sessionId = this.context.workspaceState.get<string>(this.storageKey());

    const git = new GitStatusProvider(this.folder, (line) => this.output?.appendLine(line));
    this.git = git.current;
    this.subscriptions.push(
      git,
      git.onDidChange((status) => {
        this.git = status;
        this.post({ kind: "git", git: status });
      }),
    );

    this.subscriptions.push(
      this.host.onEvent((event) => this.handleEvent(event)),
      this.host.onResync(() => void this.fullResync()),
      this.host.onState(() => this.broadcastState()),
      this.host.onError((message) => {
        this.post({ kind: "state", state: "error", error: message });
        this.post({ kind: "error", message });
        this.notify("notifications.errors", false, t("errorNotice", { message }));
      }),
      vscode.window.onDidChangeTextEditorSelection(() => this.postEditors()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.postEditors()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.postEditors()),
    );
    this.broadcastState();
    this.postEditors();
  }

  dispose(): void {
    for (const sub of this.subscriptions.splice(0)) {
      sub.dispose();
    }
    this.clearTimers();
  }

  // --- webview surfaces -------------------------------------------------

  attachSink(webview: vscode.Webview): Sink {
    const sink: Sink = {
      post: (message) => void webview.postMessage(message),
      focused: false,
    };
    this.sinks.add(sink);
    return sink;
  }

  detachSink(sink: Sink): void {
    this.sinks.delete(sink);
  }

  /** True while any chat surface holds keyboard focus. */
  private anySinkFocused(): boolean {
    for (const sink of this.sinks) {
      if (sink.focused) {
        return true;
      }
    }
    return false;
  }

  /**
   * Show a VS Code notification. It is skipped when the user is already
   * looking at the chat — the panel says the same thing — and when the
   * matching setting is off.
   */
  private notify(key: string, fallback: boolean, message: string): void {
    if (this.anySinkFocused()) {
      return;
    }
    if (!vscode.workspace.getConfiguration("opencode").get<boolean>(key, fallback)) {
      return;
    }
    void vscode.window.showInformationMessage(message);
  }

  async handleMessage(web: WebToHost): Promise<void> {
    // 动作消息带会话戳：切换的精神分裂窗口内（宿主已翻到新会话、webview
    // 还渲染着旧会话），落在旧会话界面上的点击直接丢弃，不打进新会话。
    if (isStaleAction(web, this.sessionId)) {
      return;
    }
    switch (web.kind) {
      case "ready":
        await this.fullResync();
        break;
      case "send":
        await this.send(web.text, web.attachments);
        break;
      case "removeQueued":
        this.removeQueued(web.id);
        break;
      case "forceQueued":
        await this.forceQueued(web.id);
        break;
      case "resumeQueue":
        this.resumeQueue();
        break;
      case "stopSubagent":
        await this.stopSubagent(web.childSessionID);
        break;
      case "abort":
        if (this.sessionId) {
          await this.safeCall(() => this.client()?.interrupt(this.sessionId ?? ""));
          if (this.busy && this.queue.length > 0) {
            this.queuePaused = true;
            this.postQueue();
          }
        }
        break;
      case "openFile":
        await this.safeCall(() => this.openFile(web.path, web.start, web.end));
        break;
      case "openUrl":
        await this.safeCall(() => vscode.env.openExternal(vscode.Uri.parse(web.url)));
        break;
      case "copyCode":
        await this.safeCall(() => vscode.env.clipboard.writeText(web.text));
        break;
      case "previewAttachment":
        await this.safeCall(() =>
          this.previewAttachment(web.requestId, web.ref, web.start, web.end),
        );
        break;
      case "newSession":
        await this.newSession();
        break;
      case "showHistory":
        await this.postHistory();
        break;
      case "renameSession":
        await this.renameSessionById(web.id, web.currentTitle);
        break;
      case "deleteSession":
        await this.deleteSessionById(web.id);
        break;
      case "forkSession":
        await this.forkSession(web.id);
        break;
      case "exportSession":
        await this.exportSession(web.id);
        break;
      case "openSourceControl":
        await this.safeCall(() => this.openSourceControl());
        break;
      case "revealInExplorer":
        await this.safeCall(() => this.revealInExplorer(web.path));
        break;
      case "runCommand":
        await this.executeRunCommand(web.command, web.arguments);
        break;
      case "switchSession":
        await this.switchSession(web.id);
        break;
      case "setAgent": {
        if (!this.sessionId) {
          // No server session yet — remember the choice and send it with the
          // session creation instead of calling /api/session//agent.
          this.pendingAgent = web.agent;
          this.agent = web.agent;
          this.post({ kind: "sessionMeta", agent: web.agent });
          break;
        }
        await this.safeCall(async () => {
          const client = this.client();
          if (!client || !this.sessionId) {
            return;
          }
          await client.setAgent(this.sessionId, web.agent);
          this.agent = web.agent;
          this.post({ kind: "sessionMeta", sessionID: this.sessionId, agent: web.agent });
        });
        break;
      }
      case "setModel": {
        const model = {
          providerID: web.providerID,
          id: web.id,
          variant: web.variant,
        };
        if (!this.sessionId) {
          this.pendingModel = model;
          this.model = model;
          this.post({ kind: "sessionMeta", model });
          break;
        }
        await this.safeCall(async () => {
          const client = this.client();
          if (!client || !this.sessionId) {
            return;
          }
          await client.setModel(this.sessionId, model);
          this.model = model;
          this.post({ kind: "sessionMeta", sessionID: this.sessionId, model });
        });
        break;
      }
      case "stageImage":
        // 记录请求发起时的会话：结果回传时带会话戳，webview 据此隔离。
        this.stageImage(web.requestId, web.name, web.dataBase64, web.mime, this.sessionId);
        break;
      case "rewindTo":
        await this.rewindTo(web.messageID);
        break;
      case "permissionReply":
        await this.replyPermission(web.requestID, web.decision);
        break;
      case "formReply":
        await this.replyForm(web.formID, web.answer);
        break;
      case "formCancel":
        await this.cancelForm(web.formID);
        break;
      case "openDiff":
        await this.openDiff(web.file);
        break;
      case "revertFile":
        await this.revertFile(web.file);
        break;
      case "searchFiles":
        await this.searchFiles(web.requestId, web.query, this.sessionId);
        break;
      case "pickFiles":
        await this.pickFiles(web.requestId, this.sessionId);
        break;
      case "openCLI":
        await this.openCLI();
        break;
      case "showLogs":
        await vscode.commands.executeCommand("opencode.showLogs");
        break;
      case "cycleAgent":
        this.cycleAgent(web.direction);
        break;
      case "restartServer":
        await this.host.restart();
        break;
      case "openSettings":
        await vscode.commands.executeCommand("opencode.openSettings");
        break;
      case "focusChanged":
        // Handled by the surface bridge, which knows which sink sent it.
        break;
    }
  }

  // --- state -------------------------------------------------------

  private client() {
    // Silent on purpose: the connection banner already surfaces the problem;
    // repeating it here would spam the error list on every user action.
    return this.host.client();
  }

  private storageKey(): string {
    return `opencode.activeSession:${toServerPath(this.folder.uri.fsPath)}`;
  }

  private post(message: HostToWeb): void {
    for (const sink of this.sinks) {
      sink.post(message);
    }
  }

  private broadcastState(): void {
    const config = vscode.workspace.getConfiguration("opencode");
    this.post({
      kind: "state",
      state: this.host.currentState,
      version: this.host.server?.version,
      error: this.host.lastError,
      compatWarning: this.host.compatWarning,
      locale: getLocale(),
      composer: {
        submitKey: config.get<"enter" | "ctrlEnter">("composer.submitKey", "enter"),
        showContextBar: config.get<boolean>("composer.showContextBar", true),
      },
      diffList: {
        maxVisibleRows: Math.max(1, config.get<number>("diffList.maxVisibleRows", 5)),
      },
    });
  }

  /** Re-push state so composer settings changed in the middle of a session apply. */
  refreshUiSettings(): void {
    this.broadcastState();
  }

  private async safeCall(fn: () => unknown): Promise<void> {
    try {
      await Promise.resolve(fn());
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // --- editor context ------------------------------------------------

  /**
   * Editor tabs know whether they hold a selection: only a selected editor is
   * a citable range, an open-but-unselected one is just a suggestion.
   *
   * A tab is not necessarily a `TabInputText`: a Markdown/notebook preview is a
   * custom editor or a notebook, and the file behind those is just as citable,
   * so any tab pointing at a real file counts.
   */
  private collectEditors(): EditorFile[] {
    const selected = new Map<string, { start: number; end: number }>();
    for (const editor of vscode.window.visibleTextEditors) {
      if (!editor.selection.isEmpty) {
        selected.set(editor.document.uri.fsPath, {
          start: editor.selection.start.line + 1,
          end: editor.selection.end.line + 1,
        });
      }
    }
    const files: EditorFile[] = [];
    const seen = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const fsPath = tabFilePath(tab.input);
        if (!fsPath || seen.has(fsPath)) {
          continue;
        }
        seen.add(fsPath);
        files.push({ path: fsPath, name: pathBasename(fsPath), selected: selected.get(fsPath) });
      }
    }
    return files.sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)));
  }

  private postEditors(): void {
    const editors = this.collectEditors();
    if (JSON.stringify(editors) === JSON.stringify(this.editors)) {
      return;
    }
    this.editors = editors;
    this.post({ kind: "editors", editors });
  }

  // --- session lifecycle ---------------------------------------------

  async newSession(): Promise<void> {
    await this.createSession();
  }

  /**
   * Create a fresh session. Picker choices made on the empty panel are sent in
   * the create body so the session starts with the requested agent/model.
   */
  private async createSession(): Promise<string | undefined> {
    const client = this.client();
    if (!client) {
      return undefined;
    }
    const pendingAgent = this.pendingAgent;
    const pendingModel = this.pendingModel;
    this.pendingAgent = undefined;
    this.pendingModel = undefined;
    // A new session starts empty; anything queued or dismissed in the old one
    // stays there.
    this.stashQueue();
    this.stashDismissed();
    try {
      const created = await client.createSession({ location: { directory: this.host.folderPath } });
      const sessionId = created.data.id;
      this.sessionId = sessionId;
      this.isSubagentSession = false;
      this.messages = [];
      this.resetStreams();
      this.pending = [];
      this.diffs = [];
      this.turnCache = undefined;
      // 泊出旧会话、载入新会话的空表（spec Q10）：新会话从零开始记忆。
      this.loadDismissed(sessionId);
      this.busy = false;
      this.cacheHitRate = undefined;
      this.contextTokens = undefined;
      this.revertMessageID = undefined;
      this.clearSubagents();
      this.loadQueue(sessionId);
      this.clearForms();
      this.title = created.data.title;
      this.agent = created.data.agent ?? "build";
      this.model = created.data.model;
      await this.context.workspaceState.update(this.storageKey(), this.sessionId);
      // Apply the pre-session picker choices through the same endpoints the
      // pickers use once a session exists; the create body is not guaranteed
      // to carry them on every server build.
      if (pendingAgent) {
        await this.safeCall(() => client.setAgent(sessionId, pendingAgent));
      }
      if (pendingModel) {
        await this.safeCall(() => client.setModel(sessionId, pendingModel));
      }
      await this.refreshSessionMeta();
      this.postSnapshot();
      return this.sessionId;
    } catch (error) {
      this.pendingAgent = pendingAgent;
      this.pendingModel = pendingModel;
      this.post({ kind: "error", message: errorMessage(error) });
      return undefined;
    }
  }

  async switchSession(id: string): Promise<void> {
    this.stashQueue();
    this.stashDismissed();
    this.sessionId = id;
    this.isSubagentSession = false;
    this.pendingAgent = undefined;
    this.pendingModel = undefined;
    // 换会话即离开旧回合的执行窗口：busy 必须先归零（spec 分支 4），
    // 否则旧会话的 busy 残留会让新会话误显“处理中”并污染 postHistory 戳记；
    // 若新会话真在跑，fullResync → refreshSessionMeta 会重新置位。
    this.busy = false;
    await this.context.workspaceState.update(this.storageKey(), id);
    this.messages = [];
    this.resetStreams();
    this.pending = [];
    this.diffs = [];
    this.turnCache = undefined;
    // 泊出旧会话、载入目标会话的驻留（无泊位则空表，spec Q10）：
    // 切走不再失忆，切回不再复活已撤销的行。
    this.loadDismissed(id);
    this.loadQueue(id);
    this.clearForms();
    this.clearSubagents();
    // 早快照（issue 04a）：同步清理一完成就翻 webview 的会话页——旧会话的
    // 队列条/输入框立刻消失，精神分裂窗口从 UI 侧关闭；fullResync 随后补
    // 权威数据。此刻 busy 尚无新会话的可靠同步值（activeSessions 是异步
    // 端点），先带复位标志，refreshSessionMeta（busy > idle 谓词）在一个
    // 往返内纠正。
    this.postSnapshot();
    await this.fullResync();
    this.drainRestoredQueue();
    await vscode.commands.executeCommand("opencode.chat.focus");
  }

  // --- messaging ------------------------------------------------------

  async send(text: string, attachments: AttachmentRef[]): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    if (!this.sessionId) {
      const created = await this.createSession();
      if (!created) {
        return;
      }
    }
    if (this.busy) {
      // 排队仅发生在“主回合执行中”窗口（spec 分支 8）：busy=true 即主回合
      // 在跑。“等待子代理”窗口（主回合已结束、仅子代理 job 在跑）busy=false，
      // 消息会直接走 sendNow——服务器接受为 steer 或开启新回合，不本地扣留。
      this.queue.push({ id: randomBytes(6).toString("hex"), text, attachments });
      // A new user message means the queue should move again after this turn.
      this.queuePaused = false;
      this.postQueue();
      return;
    }
    await this.sendNow(text, attachments);
  }

  /** Start a turn immediately. Callers guarantee that the session is idle. */
  private async sendNow(text: string, attachments: AttachmentRef[]): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    // Links have no attachment form on the prompt API; they travel in the text.
    const links = attachments.filter((attachment) => attachment.kind === "url");
    const staged = attachments.filter((attachment) => attachment.kind !== "url");
    const promptAttachments: PromptFileAttachment[] = staged.map((attachment) =>
      this.toPromptAttachment(attachment),
    );
    const autoAttach = vscode.workspace
      .getConfiguration("opencode")
      .get<boolean>("context.autoAttachSelection", true);
    if (autoAttach) {
      const selection = this.activeSelection();
      const alreadyAttached = staged.some((a) => a.ref === selection?.path);
      if (selection && !alreadyAttached) {
        promptAttachments.push(this.selectionAttachment(selection));
      }
    }
    for (const attachment of staged) {
      this.stagedImages.delete(attachment.ref);
    }
    const promptText = appendLinks(
      text,
      links.map((link) => link.ref),
    );
    // The rows the user reverted stay dismissed across turns: the signature
    // memory is self-sufficient, only a changed signature revives a row
    // (spec 决策 Q6/Q9).
    this.busy = true;
    this.turnFailed = false;
    this.post({ kind: "busy", sessionID: this.sessionId, busy: true });
    this.startPermissionPolling();
    this.startSubagentPolling();
    // Optimistic local bubble: the user sees their message instantly instead
    // of waiting for the server round-trip; the authoritative refresh replaces
    // it with the real user message (with attachment metadata) moments later.
    const localMessage: MessageInfo = {
      type: "user",
      id: `local-${Date.now()}`,
      time: { created: Date.now() },
      text,
    };
    this.messages.push(localMessage);
    this.post({ kind: "messages", sessionID: this.sessionId, messages: this.mergedMessages() });
    // Remember the model actually in use for the picker's Recent section.
    const usedModel = this.model ?? this.host.catalog.defaultModel;
    if (usedModel) {
      this.host.recordModelUsed(usedModel);
    }
    try {
      await client.prompt(this.sessionId ?? "", { text: promptText, files: promptAttachments });
    } catch (error) {
      // The server never accepted the turn, so nothing will emit session.idle:
      // end it here or the send button stays in its stop state forever.
      this.failTurn(error);
    }
  }

  // --- queued messages ---------------------------------------------------

  private postQueue(): void {
    this.post({ kind: "queue", sessionID: this.sessionId, queue: this.queue, paused: this.queuePaused });
  }

  private removeQueued(id: string): void {
    const removed = this.queue.find((item) => item.id === id);
    if (!removed) {
      return;
    }
    this.discardQueuedAttachments([removed]);
    this.queue = this.queue.filter((item) => item.id !== id);
    if (this.queue.length === 0) {
      this.queuePaused = false;
    }
    this.postQueue();
  }

  /** Drop staged images held for messages that will never be sent. */
  private discardQueuedAttachments(items: QueuedMessage[]): void {
    for (const item of items) {
      for (const attachment of item.attachments) {
        this.stagedImages.delete(attachment.ref);
      }
    }
  }

  /** Release the staged images a discarded parked queue was holding. */
  private discardSnapshot(snapshot: QueueSnapshot): void {
    this.discardQueuedAttachments(
      snapshot.pendingForce ? [...snapshot.items, snapshot.pendingForce] : snapshot.items,
    );
  }

  private resumeQueue(): void {
    this.queuePaused = false;
    this.postQueue();
    this.drainQueue();
  }

  private async forceQueued(id: string): Promise<void> {
    const item = this.queue.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    this.queue = this.queue.filter((entry) => entry.id !== id);
    this.queuePaused = false;
    this.postQueue();
    if (!this.busy) {
      await this.sendNow(item.text, item.attachments);
      return;
    }
    const client = this.client();
    if (!client || !this.sessionId) {
      this.queue.unshift(item);
      this.postQueue();
      return;
    }
    // The prompt must not reach the server while the old turn is still running:
    // hold the item and start it from the interrupted turn's end event.
    this.pendingForce = item;
    try {
      await client.interrupt(this.sessionId);
    } catch (error) {
      this.pendingForce = undefined;
      this.queue.unshift(item);
      this.postQueue();
      this.post({ kind: "error", message: errorMessage(error) });
    }
  }

  /** Start the queue head if the turn is over. Returns whether it did. */
  private drainQueue(): boolean {
    if (this.queuePaused || this.busy || this.queue.length === 0) {
      return false;
    }
    const head = this.queue.shift();
    if (!head) {
      return false;
    }
    this.postQueue();
    this.startQueued(head);
    return true;
  }

  private startQueued(item: QueuedMessage): void {
    void this.sendNow(item.text, item.attachments);
  }

  /** A session switch must not leak messages into the new conversation. */
  private resetQueue(sessionID: string | undefined = this.sessionId): void {
    const saved = this.sessionQueues.drop(sessionID);
    this.discardSnapshot({ items: this.queue, paused: this.queuePaused, pendingForce: this.pendingForce });
    if (saved) {
      this.discardSnapshot(saved);
    }
    this.queue = [];
    this.queuePaused = false;
    this.pendingForce = undefined;
    this.clearForms();
  }

  /** Park the current session's queue so switching back can restore it. */
  private stashQueue(sessionID: string | undefined = this.sessionId): void {
    this.sessionQueues.stash(sessionID, {
      items: this.queue,
      paused: this.queuePaused,
      pendingForce: this.pendingForce,
    });
  }

  /** Load a session's parked queue into the live fields. */
  private loadQueue(sessionID: string | undefined): void {
    const snapshot = this.sessionQueues.take(sessionID);
    this.queue = snapshot.items;
    this.queuePaused = snapshot.paused;
    this.pendingForce = snapshot.pendingForce;
  }

  /** Park the current session's dismissed rows so switching back can restore them. */
  private stashDismissed(sessionID: string | undefined = this.sessionId): void {
    this.sessionDismissed.stash(sessionID, this.dismissed);
  }

  /** Load a session's parked dismissed rows into the live map. */
  private loadDismissed(sessionID: string | undefined): void {
    this.dismissed = this.sessionDismissed.take(sessionID);
  }

  /**
   * After `fullResync`, a restored queue belongs to a session that may have
   * finished its turn while the user was elsewhere: send what was waiting.
   */
  private drainRestoredQueue(): void {
    if (this.pendingForce) {
      const forced = this.pendingForce;
      this.pendingForce = undefined;
      if (this.busy) {
        this.queue.unshift(forced);
      } else {
        this.startQueued(forced);
        return;
      }
    }
    if (!this.busy) {
      this.drainQueue();
    }
    this.postQueue();
  }

  private clearForms(): void {
    // 表单同样属于旧会话：切换/新建/删除即丢弃，避免旧会话的
    // question 卡片污染新会话（与 messages/pending 同一套隔离原则）。
    if (this.forms.length > 0) {
      this.forms = [];
      this.post({ kind: "forms", sessionID: this.sessionId, forms: [] });
    }
  }

  /** Map a composer attachment to the prompt body's file shape. */
  private toPromptAttachment(attachment: AttachmentRef): PromptFileAttachment {
    const staged = this.stagedImages.get(attachment.ref);
    if (staged) {
      return promptAttachment(attachment.ref, staged);
    }
    if (attachment.kind === "selection" && attachment.range) {
      return rangeAttachment(
        attachment.ref,
        attachment.name,
        attachment.range.start,
        attachment.range.end,
      );
    }
    return promptAttachment(attachment.ref);
  }

  private selectionAttachment(selection: {
    path: string;
    start?: number;
    end?: number;
    note?: string;
  }): PromptFileAttachment {
    if (selection.start === undefined || selection.end === undefined) {
      return { ...promptAttachment(selection.path), description: selection.note };
    }
    return rangeAttachment(
      selection.path,
      pathBasename(selection.path),
      selection.start,
      selection.end,
    );
  }

  /** Switch the workbench to the Source Control view. */
  private async openSourceControl(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.scm");
  }

  /** Switch to the Explorer view and highlight the workspace folder; fall back
   *  to a plain view switch when the reveal command is not available. */
  private async revealInExplorer(path: string): Promise<void> {
    try {
      await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(path));
    } catch {
      await vscode.commands.executeCommand("workbench.view.explorer");
    }
  }

  /** Open a file (optionally revealing a line range) in the editor. */
  private async openFile(file: string, start?: number, end?: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (start === undefined) {
      return;
    }
    const first = Math.min(Math.max(1, start), document.lineCount);
    const last = Math.min(Math.max(first, end ?? first), document.lineCount);
    const range = new vscode.Range(first - 1, 0, last - 1, document.lineAt(last - 1).text.length);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  /**
   * Read what an attachment points at so the composer can preview it without
   * leaving the panel: images come back inline, files as a window of lines.
   */
  private async previewAttachment(
    requestId: string,
    ref: string,
    start?: number,
    end?: number,
  ): Promise<void> {
    const staged = this.stagedImages.get(ref);
    if (staged) {
      this.post({
        kind: "attachmentPreview",
        preview: { requestId, dataUrl: `data:${staged.mime};base64,${staged.data}` },
      });
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(ref));
      const lines = Buffer.from(bytes).toString("utf8").split(/\r?\n/);
      const firstLine = Math.max(1, (start ?? 1) - 6);
      const lastLine = Math.min(lines.length, Math.max(end ?? start ?? 1, firstLine) + 12);
      this.post({
        kind: "attachmentPreview",
        preview: {
          requestId,
          text: lines.slice(firstLine - 1, lastLine).join("\n"),
          firstLine,
          highlight: start !== undefined ? { start, end: end ?? start } : undefined,
        },
      });
    } catch (error) {
      this.post({
        kind: "attachmentPreview",
        preview: { requestId, error: errorMessage(error) },
      });
    }
  }

  /** Abort the local turn after a request that never reached the agent loop. */
  private failTurn(error: unknown): void {
    this.busy = false;
    this.turnFailed = true;
    this.stopPermissionPolling();
    this.post({ kind: "busy", sessionID: this.sessionId, busy: false });
    if (this.queue.length > 0) {
      this.queuePaused = true;
      this.postQueue();
    }
    const message = errorMessage(error);
    this.post({ kind: "error", message });
    this.notify("notifications.errors", false, t("errorNotice", { message }));
  }

  private activeSelection():
    | { path: string; start?: number; end?: number; note?: string }
    | undefined {
    const max = vscode.workspace
      .getConfiguration("opencode")
      .get<number>("context.maxSelectionLength", 2000);
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return undefined;
    }
    const path = editor.document.uri.fsPath;
    if (!path.startsWith(this.folder.uri.fsPath)) {
      return undefined;
    }
    if (editor.document.getText(editor.selection).length > max) {
      return { path, note: t("selectionTooLong") };
    }
    return {
      path,
      start: editor.selection.start.line + 1,
      end: editor.selection.end.line + 1,
    };
  }

  /** Execute a slash command: built-ins client-side, the rest on the server. */
  private async executeRunCommand(command: string, args: string): Promise<void> {
    const action = resolveCommandAction(command);
    if (action.kind === "client") {
      switch (action.action) {
        case "new":
          await this.newSession();
          return;
        case "undo": {
          const lastUser = [...this.messages].reverse().find((m) => m.type === "user");
          if (lastUser) {
            await this.rewindTo(lastUser.id);
          } else {
            this.post({ kind: "error", message: t("nothingToUndo") });
          }
          return;
        }
        case "export":
          if (this.sessionId) {
            await this.exportSession(this.sessionId);
          }
          return;
        case "fork":
          if (this.sessionId) {
            await this.forkSession(this.sessionId);
          }
          return;
        case "compact":
          if (this.sessionId) {
            await this.safeCall(() => this.client()?.compact(this.sessionId ?? ""));
            await this.refreshMessages();
          }
          return;
      }
    }
    // A `/name` that names a skill is a skill mention, not a server command:
    // the server loads skills from `@<id>` in the prompt text, so the typed
    // command (and any arguments) is forwarded as the message.
    const skill = findSkillByCommand(this.host.catalog.skills, command);
    if (skill) {
      await this.send(`@${skill.id}${args ? ` ${args}` : ""}`, []);
      return;
    }
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    await this.safeCall(() => client.runCommand(this.sessionId ?? "", command, args));
    await this.refreshMessages();
  }

  /**
   * Hold a pasted/dropped image in memory until the message is sent: the
   * prompt API rejects temp-file paths, and inline data URIs also work when
   * the server runs on another host.
   */
  private stageImage(
    requestId: string,
    name: string,
    dataBase64: string,
    mime: string,
    sessionID?: string,
  ): void {
    const ref = `staged:${requestId}`;
    this.stagedImages.set(ref, {
      name: name || "image.png",
      mime: mime || "image/png",
      data: dataBase64,
    });
    this.post({ kind: "imageStaged", requestId, path: ref, name, sessionID });
  }

  /** Rewind the session to just before the given message, reverting its file changes. */
  private async rewindTo(messageID: string): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      t("rewindConfirm"),
      { modal: true },
      t("rewindButton"),
    );
    if (confirm !== t("rewindButton")) {
      return;
    }
    await this.safeCall(async () => {
      await client.revertStage(this.sessionId ?? "", messageID);
      await client.revertCommit(this.sessionId ?? "");
      this.resetStreams();
      this.dismissed.clear();
      this.turnCache = undefined;
      // Pick up the server's revert point before recomputing the context
      // gauge, which stops at that point.
      await this.refreshSessionMeta();
      await this.refreshMessages();
      await this.refreshDiffs();
    });
  }

  /** Fetch sessions and push date-grouped history to the webview menu. */
  private async postHistory(): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(async () => {
      const [page, active, permissions] = await Promise.all([
        client.listSessions({
          directory: this.host.folderPath,
          limit: 100,
          order: "desc",
          archived: false,
        }),
        // Older servers may not expose the active-session map; a missing dot
        // state is better than a history menu that refuses to open.
        client
          .activeSessions()
          .catch(() => ({ data: {} as Record<string, { type?: string }> })),
        client.pendingPermissions(this.host.folderPath),
      ]);
      const activeIDs = new Set(Object.keys(active.data));
      if (this.busy && this.sessionId) {
        activeIDs.add(this.sessionId);
      }
      const blockedIDs = new Set(permissions.data.map((request) => request.sessionID));
      const rows: HistoryRow[] = page.data.map((session) => ({
        id: session.id,
        title: session.title,
        parentID: session.parentID,
        created: session.time.created,
        updated: session.time.updated,
        status: deriveSessionStatus(session, activeIDs, blockedIDs),
      }));
      this.post({ kind: "history", groups: groupFoldedByDate(foldSubagentSessions(rows)) });
    });
  }

  private async renameSessionById(id: string, currentTitle?: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: t("sessionNamePrompt"),
      value: currentTitle ?? "",
    });
    if (name !== undefined) {
      await this.safeCall(() => this.client()?.patchSession(id, { title: name }));
    }
  }

  private async deleteSessionById(id: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      t("deleteSessionConfirm"),
      { modal: true },
      t("deleteButton"),
    );
    if (confirm === t("deleteButton")) {
      await this.safeCall(() => this.client()?.deleteSession(id));
      if (this.sessionId === id) {
        this.resetQueue(id);
        // 该会话的驻留记忆一并清掉：删除的会话不得留下幽灵记忆（spec Q10）。
        this.sessionDismissed.drop(id);
        this.dismissed.clear();
        this.sessionId = undefined;
        this.messages = [];
        this.pending = [];
        this.diffs = [];
        this.turnCache = undefined;
        this.busy = false;
        void this.context.workspaceState.update(this.storageKey(), undefined);
        this.postSnapshot();
      } else {
        const saved = this.sessionQueues.drop(id);
        if (saved) {
          this.discardSnapshot(saved);
        }
        this.sessionDismissed.drop(id);
      }
    }
  }

  /** Fork (copy) a session and switch to the copy. */
  async forkSession(id: string): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    try {
      const forked = await client.forkSession(id);
      await this.switchSession(forked.id);
      void vscode.commands.executeCommand("opencode.chat.focus");
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Export the session transcript as a Markdown file. */
  async exportSession(id: string): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    try {
      const page = await client.listMessages(id);
      const lines: string[] = [`# OpenCode session`, ""];
      for (const message of page.data) {
        if (message.type === "user") {
          const user = message as UserMessage;
          lines.push(`## 🧑 User`, "", user.text, "");
          for (const file of user.files ?? []) {
            if (file.name) {
              lines.push(`- 📄 \`${file.name}\``);
            }
          }
          lines.push("");
        } else if (message.type === "assistant") {
          const assistant = message as AssistantMessage;
          lines.push(`## 🤖 Assistant`, "");
          for (const part of assistant.content) {
            // 导出内容与界面所见一致：同样剥离 DCP 标记回显（spec 分支 2）。
            if (part.type === "text" && part.text) {
              lines.push(stripTrailingMarkers(part.text), "");
            } else if (part.type === "reasoning" && part.text) {
              lines.push(
                `<details><summary>Thinking</summary>`,
                "",
                stripTrailingMarkers(part.text),
                "",
                `</details>`,
                "",
              );
            } else if (part.type === "tool") {
              const summary = toolLine(part.name, part.state.input);
              lines.push(`- \`${part.name}\` ${summary}`);
            }
          }
          lines.push("");
        }
      }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(this.folder.uri, "opencode-session.md"),
        filters: { Markdown: ["md"] },
      });
      if (!target) {
        return;
      }
      await vscode.workspace.fs.writeFile(target, Buffer.from(lines.join("\n"), "utf8"));
      void vscode.window.showInformationMessage(t("exportedTo", { path: target.fsPath }));
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // --- event handling ---------------------------------------------------

  private handleEvent(event: { type: string; data: Record<string, unknown> }): void {
    const data = event.data;
    const eventSession = typeof data.sessionID === "string" ? data.sessionID : undefined;
    switch (event.type) {
      case "session.text.started":
      case "session.reasoning.started": {
        const kind: SegmentKind = event.type === "session.text.started" ? "text" : "reasoning";
        const messageID =
          typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined;
        if (this.sessionId && eventSession === this.sessionId && messageID) {
          const ordinal = ordinalOf(data);
          this.streamFor(messageID).start(kind, ordinal);
          this.post(
            kind === "text"
              ? { kind: "textStarted", sessionID: eventSession, messageID, ordinal }
              : { kind: "reasoningStarted", sessionID: eventSession, messageID, ordinal },
          );
        }
        break;
      }
      case "session.text.delta":
      case "session.reasoning.delta": {
        const kind: SegmentKind = event.type === "session.text.delta" ? "text" : "reasoning";
        const messageID =
          typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined;
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (this.sessionId && eventSession === this.sessionId && messageID && delta) {
          const ordinal = ordinalOf(data);
          this.streamFor(messageID).append(kind, ordinal, delta);
          this.queueDelta(eventSession, messageID, kind, ordinal, delta);
        }
        break;
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        const kind: SegmentKind = event.type === "session.text.ended" ? "text" : "reasoning";
        const messageID =
          typeof data.assistantMessageID === "string" ? data.assistantMessageID : undefined;
        if (this.sessionId && eventSession === this.sessionId && messageID) {
          const ordinal = ordinalOf(data);
          const text = typeof data.text === "string" ? data.text : "";
          // Queued deltas belong before the closing text, otherwise the webview
          // would append an older tail on top of the authoritative part.
          this.flushDeltas();
          this.streamFor(messageID).end(kind, ordinal, text);
          this.post(
            kind === "text"
              ? { kind: "textEnded", sessionID: eventSession, messageID, ordinal, text }
              : { kind: "reasoningEnded", sessionID: eventSession, messageID, ordinal, text },
          );
        }
        break;
      }
      case "session.message.content.updated": {
        // The server pushes the message's whole content array as it changes;
        // this is the authoritative part list, so it replaces polling guesses.
        const messageID = typeof data.messageID === "string" ? data.messageID : undefined;
        if (
          this.sessionId &&
          eventSession === this.sessionId &&
          messageID &&
          Array.isArray(data.content)
        ) {
          const content = data.content as AssistantContent[];
          this.liveContent.set(messageID, content);
          this.post({ kind: "messageContent", sessionID: eventSession, messageID, content });
        }
        break;
      }
      case "session.step.started":
      case "session.execution.started":
        if (eventSession === this.sessionId) {
          this.busy = true;
          this.post({ kind: "busy", sessionID: this.sessionId, busy: true });
          // 服务器拉起的回合（steer/continuation）也会启动子代理，
          // 轮询必须同样跟上（spec 分支 6）；已启动时为幂等 no-op。
          this.startSubagentPolling();
          // 服务器拉起的回合同样可能弹权限/提问表单，兜底轮询一并跟上。
          this.startPermissionPolling();
        }
        break;
      case "session.idle":
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        if (eventSession === this.sessionId) {
          const wasBusy = this.busy;
          this.busy = false;
          this.flushDeltas();
          this.post({ kind: "busy", sessionID: this.sessionId, busy: false });
          this.stopPermissionPolling();
          // 回合结束不再盲清 strip（spec 分支 6）：子代理 job 与回合解耦、
          // 可跨回合存活，先做一次最终刷新——仍有 running job 就保留轮询
          // 让 strip 跟到它们全部结束，全空才清空并停轮询。
          void this.settleSubagents();
          if (wasBusy) {
            if (event.type === "session.execution.failed") {
              this.notify("notifications.errors", false, t("turnFailed"));
            } else if (!this.turnFailed && event.type !== "session.execution.interrupted") {
              this.notify(
                "notifications.turnComplete",
                true,
                this.title ? t("turnCompleteNamed", { title: this.title }) : t("turnComplete"),
              );
            }
          }
          if (wasBusy && this.pendingForce) {
            // The interrupted turn is finally over — start the forced message.
            const forced = this.pendingForce;
            this.pendingForce = undefined;
            this.startQueued(forced);
          } else if (
            wasBusy &&
            (event.type === "session.execution.failed" ||
              event.type === "session.execution.interrupted")
          ) {
            if (this.queue.length > 0) {
              this.queuePaused = true;
              this.postQueue();
            }
            this.scheduleMessagesRefresh(0);
          } else if (wasBusy && !this.drainQueue()) {
            this.scheduleMessagesRefresh(0);
          } else if (!wasBusy) {
            this.scheduleMessagesRefresh(0);
          }
          this.scheduleSessionMetaRefresh();
          void this.refreshDiffs();
        }
        break;
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed":
      case "session.tool.progress":
      case "session.step.ended":
      case "session.step.failed":
      case "session.step.streamed":
        if (eventSession === this.sessionId) {
          this.scheduleMessagesRefresh();
          void this.refreshDiffs();
        }
        break;
      case "session.permissions":
        if (eventSession === undefined || eventSession === this.sessionId) {
          void this.refreshPermissions();
        }
        break;
      case "form.created": {
        // The `question` tool: the server parked a form and the turn blocks
        // until we answer or cancel. The event carries the full form.
        // 实测 v2.3.0：sessionID 只在 data.form.sessionID，data 顶层没有
        // sessionID —— 必须从表单对象兜底，否则卡片永远等不到实时推送。
        const form = data.form as FormInfo | undefined;
        const formSession = formEventSession(data);
        if (form && formSession === this.sessionId) {
          this.forms = [...this.forms.filter((f) => f.id !== form.id), form];
          this.post({ kind: "forms", sessionID: this.sessionId, forms: this.forms });
          this.notify("notifications.permissionRequest", true, t("questionNotice"));
          // The event stream is lossy; keep polling as the authoritative backstop.
          this.startPermissionPolling();
        }
        break;
      }
      case "form.replied":
      case "form.cancelled":
        if (eventSession === this.sessionId) {
          const formID = typeof data.id === "string" ? data.id : undefined;
          if (formID) {
            this.forms = this.forms.filter((f) => f.id !== formID);
            this.post({ kind: "forms", sessionID: this.sessionId, forms: this.forms });
            this.scheduleMessagesRefresh(0);
          }
        }
        break;
      case "session.agent.selected":
        if (eventSession === this.sessionId && typeof data.agent === "string") {
          this.agent = data.agent;
          this.post({ kind: "sessionMeta", sessionID: this.sessionId, agent: data.agent });
        }
        break;
      case "session.model.selected":
        if (
          eventSession === this.sessionId &&
          typeof data.model === "object" &&
          data.model !== null
        ) {
          const model = data.model as { providerID?: string; id?: string; variant?: string };
          if (model.providerID && model.id) {
            this.model = { providerID: model.providerID, id: model.id, variant: model.variant };
            this.post({ kind: "sessionMeta", sessionID: this.sessionId, model: this.model });
          }
        }
        break;
      case "session.renamed":
        if (eventSession === this.sessionId && typeof data.title === "string") {
          this.title = data.title;
          this.post({ kind: "sessionMeta", sessionID: this.sessionId, title: data.title });
        }
        break;
      case "session.deleted":
        if (eventSession === this.sessionId) {
          this.resetQueue(eventSession);
          // 该会话的驻留记忆一并清掉：删除的会话不得留下幽灵记忆（spec Q10）。
          this.sessionDismissed.drop(eventSession);
          this.sessionId = undefined;
          this.messages = [];
          this.resetStreams();
          this.pending = [];
          this.diffs = [];
          this.turnCache = undefined;
          this.dismissed.clear();
          this.busy = false;
          this.clearSubagents();
          this.cacheHitRate = undefined;
          this.contextTokens = undefined;
          this.revertMessageID = undefined;
          void this.context.workspaceState.update(this.storageKey(), undefined);
          this.postSnapshot();
        } else if (eventSession) {
          const saved = this.sessionQueues.drop(eventSession);
          if (saved) {
            this.discardSnapshot(saved);
          }
          this.sessionDismissed.drop(eventSession);
        }
        break;
      default:
        break;
    }
  }

  // --- authoritative refreshes -------------------------------------------

  private scheduleMessagesRefresh(delayMs = 300): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshMessages();
    }, delayMs);
  }

  /**
   * End-of-turn events arrive in bursts (idle + execution.succeeded …), and
   * the server finalizes the session's token totals after the last
   * message lands. One debounced `GET /api/session/{id}` refreshes the
   * context-usage readouts the webview shows under the composer;
   * without it they stay frozen at the values fetched when the session was
   * created.
   */
  private scheduleSessionMetaRefresh(delayMs = 300): void {
    if (this.metaRefreshTimer) {
      return;
    }
    this.metaRefreshTimer = setTimeout(() => {
      this.metaRefreshTimer = undefined;
      void this.refreshSessionMeta();
    }, delayMs);
  }

  private async refreshMessages(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    const sessionID = this.sessionId;
    await this.safeCall(async () => {
      const page = await client.listMessages(sessionID);
      if (!this.pollSessionCurrent(sessionID)) {
        return;
      }
      // The v2 endpoint returns newest-first; the UI renders oldest-first.
      this.messages = orderMessages(page.data);
      this.turnCache = { sessionID, messages: this.messages, at: Date.now() };
      // Context gauge and cache-hit rate read the latest assistant usage, not
      // the cumulative session counters; see contextTokensOf / cacheHitRateOf.
      this.contextTokens = contextTokensOf(this.messages, this.revertMessageID);
      this.cacheHitRate = cacheHitRateOf(this.messages, this.revertMessageID);
      this.flushDeltas();
      this.post({ kind: "messages", sessionID, messages: this.mergedMessages() });
      this.pruneStreams();
      // The turn cache just changed shape (newest turn, snapshot files), so a
      // diff refresh that ran before this landed may have used the old range.
      void this.refreshDiffs();
    });
  }

  /**
   * Overlay the live turn onto the fetched messages.
   *
   * Two sources, in order of authority: `session.message.content.updated`
   * (the server's own content array) and the delta segments, which only fill
   * the gap while the server is still writing. Nothing here mutates
   * `this.messages` — a previous version patched parts in place, which made the
   * short-lived guess outlive its turn.
   */
  private mergedMessages(): MessageInfo[] {
    return this.messages.map((message) => {
      if (message.type !== "assistant") {
        return message;
      }
      const assistant = message as AssistantMessage;
      const content = this.liveContent.get(assistant.id);
      if (content) {
        return { ...assistant, content };
      }
      const stream = this.liveStreams.get(assistant.id);
      if (!stream || stream.size === 0) {
        return assistant;
      }
      return { ...assistant, content: mergeLiveContent(assistant.content, stream) };
    });
  }

  private streamFor(messageID: string): LiveStream {
    const existing = this.liveStreams.get(messageID);
    if (existing) {
      return existing;
    }
    const stream = new LiveStream();
    this.liveStreams.set(messageID, stream);
    return stream;
  }

  /** Coalesce deltas: a fast stream must not turn into one post per token. */
  private queueDelta(
    sessionID: string,
    messageID: string,
    kind: SegmentKind,
    ordinal: number,
    delta: string,
  ): void {
    const pending = this.pendingDeltas.find(
      (item) => item.messageID === messageID && item.kind === kind && item.ordinal === ordinal,
    );
    if (pending) {
      pending.delta += delta;
    } else {
      this.pendingDeltas.push({ sessionID, messageID, kind, ordinal, delta });
    }
    if (!this.deltaTimer) {
      this.deltaTimer = setTimeout(() => this.flushDeltas(), 60);
    }
  }

  private flushDeltas(): void {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = undefined;
    }
    const batch = this.pendingDeltas.splice(0);
    for (const item of batch) {
      this.post(
        item.kind === "text"
          ? {
              kind: "textDelta",
              sessionID: item.sessionID,
              messageID: item.messageID,
              ordinal: item.ordinal,
              delta: item.delta,
            }
          : {
              kind: "reasoningDelta",
              sessionID: item.sessionID,
              messageID: item.messageID,
              ordinal: item.ordinal,
              delta: item.delta,
            },
      );
    }
  }

  private resetStreams(): void {
    this.flushDeltas();
    this.pendingDeltas.length = 0;
    this.liveStreams.clear();
    this.liveContent.clear();
  }

  /**
   * Drop live state once the server has finished a message: from then on the
   * fetched content is complete, and keeping the overlay would pin whatever the
   * deltas happened to hold.
   */
  private pruneStreams(): void {
    for (const message of this.messages) {
      if (message.type !== "assistant") {
        continue;
      }
      if (!(message as AssistantMessage).finish) {
        continue;
      }
      this.liveStreams.delete(message.id);
      this.liveContent.delete(message.id);
    }
  }

  async refreshPermissions(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(async () => {
      const result = await client.pendingPermissions(this.host.folderPath);
      const previous = this.pending.length;
      this.pending = result.data.filter((p) => p.sessionID === this.sessionId);
      this.post({ kind: "permissions", sessionID: this.sessionId, pending: this.pending });
      if (previous === 0 && this.pending.length > 0) {
        this.notify("notifications.permissionRequest", true, t("permissionNotice"));
      }
      // 表单与权限共用同一张轮询表：两者都为空才能收表，否则挂起的
      // question 表单会在权限先清空时失去兜底刷新。
      if (this.pending.length === 0 && this.forms.length === 0) {
        this.stopPermissionPolling();
      }
    });
  }

  /**
   * Pending forms for the open session. The `form.*` events are the fast path;
   * this poll is the authoritative backstop, shared with the permission timer
   * (the event stream is lossy and the turn is blocked until an answer lands).
   */
  private async refreshForms(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(async () => {
      const result = await client.sessionForms(this.sessionId ?? "");
      this.forms = result.data.filter((f) => f.sessionID === this.sessionId);
      this.post({ kind: "forms", sessionID: this.sessionId, forms: this.forms });
    });
  }

  private startPermissionPolling(): void {
    if (this.permissionTimer) {
      return;
    }
    this.permissionTimer = setInterval(() => {
      void this.refreshPermissions();
      void this.refreshForms();
    }, 1_500);
  }

  private stopPermissionPolling(): void {
    if (this.permissionTimer) {
      clearInterval(this.permissionTimer);
      this.permissionTimer = undefined;
    }
  }

  /**
   * Subagents run as child sessions, and the server exposes them only through
   * the experimental job list — no event announces a spawn or a finish. While a
   * turn is busy the panel polls that list so the strip above the composer
   * follows it; at turn end one final refresh decides: running jobs keep the
   * poll going (they outlive the turn), an empty list clears the strip.
   */
  private async refreshSubagents(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    const sessionID = this.sessionId;
    const request = ++this.subagentRequest;
    await this.safeCall(async () => {
      const result = await client.jobs(sessionID);
      // Polling restarts on every switch; a late answer from the session the
      // user just left must not repopulate (or clear) the current strip.
      if (this.pollStale(request, this.subagentRequest, sessionID)) {
        return;
      }
      this.subagents = toSubagentJobs(result.data);
      this.post({ kind: "subagents", sessionID, jobs: this.subagents });
      if (this.subagents.length === 0 && this.subagentTimer && !this.busy) {
        // 轮询发现已无运行中的子代理：收尾停轮询（strip 由上面的空列表更新关闭）。
        // 主回合仍在执行（busy）时不因空列表停表——task job 可能尚未 spawn，
        // 提前停表会错过本回合内稍后才出现的子代理（spec 分支 6）。
        this.clearSubagents();
      }
    });
  }

  /**
   * 回合结束时的 strip 收尾：最终刷新一次 jobs 列表（spec 分支 6）。
   * 仍有运行中的子代理 → 保持轮询，strip 跟到它们全部结束
   * （refreshSubagents 发现空列表时自行停轮询）；一个都没有 → 立即清空。
   */
  private async settleSubagents(): Promise<void> {
    await this.refreshSubagents();
    if (this.subagents.length > 0) {
      this.startSubagentPolling();
      return;
    }
    this.clearSubagents();
  }

  private startSubagentPolling(): void {
    if (this.subagentTimer) {
      return;
    }
    void this.refreshSubagents();
    this.subagentTimer = setInterval(() => void this.refreshSubagents(), 2_000);
  }

  private stopSubagentPolling(): void {
    if (this.subagentTimer) {
      clearInterval(this.subagentTimer);
      this.subagentTimer = undefined;
    }
  }

  /** 停轮询并清空 strip。子代理 job 与回合解耦、可跨回合存活，故本方法
   *  只在确定无需展示时调用：新会话/切换会话，或 settleSubagents 确认
   *  已无运行中的 job。 */
  private clearSubagents(): void {
    this.stopSubagentPolling();
    if (this.subagents.length === 0) {
      return;
    }
    this.subagents = [];
    this.post({ kind: "subagents", sessionID: this.sessionId, jobs: [] });
  }

  /** Stop one subagent without cancelling the turn: interrupt its child session. */
  private async stopSubagent(childSessionID: string): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(() => client.interrupt(childSessionID));
    await this.refreshSubagents();
  }

  /**
   * Ordered server messages for the session, cached briefly so a burst of
   * tool events does not re-fetch the transcript for every diff refresh.
   */
  /**
   * True when a poll's answer no longer describes the newest request or the
   * session the panel has open. Event bursts and session switches start
   * overlapping polls; applying a late one would stamp the wrong session.
   */
  private pollStale(request: number, counter: number, sessionID: string): boolean {
    return request !== counter || sessionID !== this.sessionId;
  }

  /** True when the record a poll will write is for the session still open. */
  private pollSessionCurrent(sessionID: string): boolean {
    return sessionID === this.sessionId;
  }

  /**
   * How long one cached message list may serve repeated reads. Event bursts
   * and session switches re-request within milliseconds; the cache only has
   * to collapse those, not survive a turn.
   */
  private static readonly TURN_CACHE_TTL_MS = 1_500;

  private async turnMessages(sessionID: string, client: OpencodeClient): Promise<MessageInfo[]> {
    const cached = this.turnCache;
    if (
      cached &&
      cached.sessionID === sessionID &&
      Date.now() - cached.at < ChatController.TURN_CACHE_TTL_MS
    ) {
      return cached.messages;
    }
    const page = await client.listMessages(sessionID);
    const messages = orderMessages(page.data);
    this.turnCache = { sessionID, messages, at: Date.now() };
    return messages;
  }

  private async refreshDiffs(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    const sessionID = this.sessionId;
    const request = ++this.diffRequest;
    await this.safeCall(async () => {
      const messages = await this.turnMessages(sessionID, client);
      // Event bursts and session switches start overlapping polls. Applying a
      // late answer would stamp A's files with B's session id (the webview
      // accepts it) or let an older empty poll hide a newer result.
      if (this.pollStale(request, this.diffRequest, sessionID)) {
        return;
      }
      // The diff endpoint defaults to the newest turn alone, so a follow-up
      // turn with no edits used to empty the list. Ask for the whole session
      // range, then keep only the files this session's snapshots touched.
      const result = await client.sessionDiff(sessionID, diffRange(messages));
      if (this.pollStale(request, this.diffRequest, sessionID)) {
        return;
      }
      // 空归因即空列表（ADR-0008）：范围 diff 在共享工作树上计算，
      // 无条件过滤——放行会把其他会话（或本面板自己的 revert）造成的
      // 树变化灌进这个会话的列表。
      const attribution = attributionSet(messages);
      const rows: FileDiffInfo[] = [];
      for (const diff of result.data) {
        if (!attribution.has(diffFileKey(diff.file))) {
          continue;
        }
        // added 行磁盘真相兜底（spec 决策 Q8）：B 侧被写宽归因、或窗口
        // 重载丢了内存记忆后复活的 added 行，文件多半已不在盘上，不显示。
        // deleted 不查（文件不在盘上恰是其待处理常态），modified 无法廉价校验。
        if (diff.status === "added" && !(await this.fileOnDisk(diff.file))) {
          continue;
        }
        rows.push(diff);
      }
      this.diffs = rows;
      this.broadcastDiffs();
    });
  }

  /** Stop showing a file, remembering which round of changes was dismissed. */
  private dismiss(file: string): void {
    const key = diffFileKey(file);
    const diff = this.diffs.find((entry) => diffFileKey(entry.file) === key);
    this.dismissed.set(key, diff ? diffKey(diff) : "");
  }

  /** The diffs the user has not dismissed, or has dismissed in an older round. */
  private visibleDiffs(): FileDiffInfo[] {
    return this.diffs.filter((diff) => this.dismissed.get(diffFileKey(diff.file)) !== diffKey(diff));
  }

  private broadcastDiffs(): void {
    this.post({
      kind: "diffs",
      sessionID: this.sessionId,
      diffs: this.visibleDiffs(),
    });
  }

  async refreshSessionMeta(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    const sessionID = this.sessionId;
    await this.safeCall(async () => {
      const result = await client.getSession(sessionID);
      // A late meta answer from the session the user just left would set the
      // new session's busy/title/model to the old one's values.
      if (sessionID !== this.sessionId) {
        return;
      }
      this.title = result.data.title;
      this.agent = result.data.agent;
      this.model = result.data.model;
      this.isSubagentSession = result.data.parentID !== undefined;
      this.revertMessageID = result.data.revert?.messageID;
      // busy 双向重算：服务器侧 time.busy/time.idle 是持久 epoch 时间戳，
      // "在跑"只能比较两者（busy > idle，与 sessions.ts 的
      // deriveSessionStatus 同一事实）；!time.idle 会把任何跑过回合的
      // 会话永久算成空闲（issue 03，ADR-0009）。
      this.busy = (result.data.time.busy ?? 0) > (result.data.time.idle ?? 0);
      this.post({
        kind: "sessionMeta",
        sessionID,
        title: this.title,
        agent: this.agent,
        model: this.model,
        busy: this.busy,
        contextTokens: this.contextTokens,
        cacheHitRate: this.cacheHitRate,
        isSubagentSession: this.isSubagentSession,
        created: result.data.time?.created,
        updated: result.data.time?.updated,
        cost: result.data.cost,
      });
    });
  }

  async fullResync(): Promise<void> {
    this.broadcastState();
    this.post({ kind: "catalog", catalog: this.host.catalog });
    if (!this.sessionId) {
      this.postSnapshot();
      return;
    }
    await Promise.all([
      this.refreshSessionMeta(),
      this.refreshMessages(),
      this.refreshPermissions(),
      this.refreshForms(),
      this.refreshDiffs(),
    ]);
    // 子代理 job 与回合解耦，busy 与否都可能存在运行中的 job（spec 分支 6）：
    // 切回等待子代理的父会话、面板重载、宿主 resync 都要恢复 strip，
    // 故无条件起轮询。空列表且非 busy 时 refreshSubagents 一次刷新即自停，
    // 不会造成常驻轮询。
    this.startSubagentPolling();
    this.postSnapshot();
  }

  private postSnapshot(): void {
    this.post({
      kind: "snapshot",
      snapshot: {
        sessionID: this.sessionId,
        title: this.title,
        agent: this.agent,
        model: this.model,
        busy: this.busy,
        queue: this.queue,
        queuePaused: this.queuePaused,
        forms: this.forms,
        subagents: this.subagents,
        isSubagentSession: this.isSubagentSession,
        messages: this.mergedMessages(),
        pending: this.pending,
        diffs: this.visibleDiffs(),
        catalog: this.host.catalog,
        contextTokens: this.contextTokens,
        cacheHitRate: this.cacheHitRate,
        workspacePath: this.folder.uri.fsPath,
        git: this.git,
        editors: this.editors,
        locale: getLocale(),
      },
    });
  }

  private clearTimers(): void {
    this.stopPermissionPolling();
    this.stopSubagentPolling();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.metaRefreshTimer) {
      clearTimeout(this.metaRefreshTimer);
      this.metaRefreshTimer = undefined;
    }
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = undefined;
    }
  }

  // --- permissions --------------------------------------------------------

  private async replyPermission(requestID: string, decision: "once" | "always" | "reject"): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    await this.safeCall(() => client.replyPermission(this.sessionId ?? "", requestID, decision));
    await this.refreshPermissions();
  }

  // --- forms (the `question` tool) ----------------------------------------

  /** Submit the user's answers; the blocked tool completes and the turn resumes. */
  private async replyForm(formID: string, answer: Record<string, FormAnswerValue>): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    try {
      await client.replyForm(this.sessionId ?? "", formID, answer);
    } catch (error) {
      // The server rejected the answer (e.g. required field empty) — surface it
      // and resync so the still-pending form does not vanish silently.
      this.post({ kind: "error", message: errorMessage(error) });
      await this.refreshForms();
      return;
    }
    // Optimistic removal; the authoritative refresh confirms it.
    this.forms = this.forms.filter((f) => f.id !== formID);
    this.post({ kind: "forms", sessionID: this.sessionId, forms: this.forms });
    this.scheduleMessagesRefresh(0);
  }

  /** Dismiss the questions; the server tells the model to continue without answers. */
  private async cancelForm(formID: string): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    try {
      // A cancel with feedback becomes a ToolFailure the model reads and
      // continues from; a bare cancel ends the step outright, so always explain.
      await client.cancelForm(this.sessionId ?? "", formID, "User dismissed the questions without answering.");
    } catch (error) {
      this.post({ kind: "error", message: errorMessage(error) });
      await this.refreshForms();
      return;
    }
    this.forms = this.forms.filter((f) => f.id !== formID);
    this.post({ kind: "forms", sessionID: this.sessionId, forms: this.forms });
    this.scheduleMessagesRefresh(0);
  }

  // --- diffs ------------------------------------------------------------

  private resolveFileUri(file: string): vscode.Uri {
    if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) {
      return vscode.Uri.file(file);
    }
    return vscode.Uri.joinPath(this.folder.uri, file);
  }

  /** 盘上是否存在此文件：与 `revertFile` 走同一 URI 解析路径，避免形态分歧。 */
  private async fileOnDisk(file: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.resolveFileUri(file));
      return true;
    } catch {
      return false;
    }
  }

  private async currentContent(uri: vscode.Uri, status: FileDiffInfo["status"]): Promise<string> {
    if (status === "added") {
      return "";
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return "";
    }
  }

  private async beforeContent(diff: FileDiffInfo, uri: vscode.Uri): Promise<string> {
    const after = await this.currentContent(uri, diff.status);
    try {
      return reverseApply(after, diff.patch);
    } catch {
      // Stale patch: fall back to the patch text itself so the diff still opens.
      return diff.patch;
    }
  }

  /**
   * The before content for a revert, strictly: `undefined` when the cached
   * patch no longer matches the file. Unlike `beforeContent` (whose patch-text
   * fallback only feeds a diff view), a revert must never write derived text
   * into the shared tree — refusing is the only safe answer.
   */
  private async revertedContent(diff: FileDiffInfo, uri: vscode.Uri): Promise<string | undefined> {
    const after = await this.currentContent(uri, diff.status);
    try {
      return reverseApply(after, diff.patch);
    } catch {
      return undefined;
    }
  }

  async openDiff(file: string): Promise<void> {
    const diff = this.diffs.find((d) => d.file === file);
    if (!diff) {
      return;
    }
    const uri = this.resolveFileUri(file);
    const before = await this.beforeContent(diff, uri);
    const key = randomBytes(8).toString("hex");
    this.beforeDocs.set(key, before);
    const beforeUri = vscode.Uri.from({ scheme: SCHEME, fragment: key, path: `/${pathBasename(file)}` });
    const title = `${pathBasename(file)} (${diffStatusKey(diff.status)})`;
    await vscode.commands.executeCommand("vscode.diff", beforeUri, uri, title, {
      preview: true,
    });
  }

  async revertFile(file: string): Promise<void> {
    const diff = this.diffs.find((d) => d.file === file);
    if (!diff) {
      return;
    }
    const uri = this.resolveFileUri(file);
    try {
      if (diff.status === "added") {
        await vscode.workspace.fs.delete(uri, { useTrash: true });
      } else {
        const before = await this.revertedContent(diff, uri);
        if (before === undefined) {
          // 缓存 patch 与磁盘内容不再匹配（±3 行锚定失败）：文件多半被
          // 其他会话或用户改过。不写盘、保持原样，报错让用户自行处理。
          this.post({ kind: "error", message: t("revertConflict") });
          return;
        }
        if (diff.status === "deleted") {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(uri.path.slice(0, uri.path.lastIndexOf("/"))),
          );
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(before, "utf8"));
      }
      this.dismiss(file);
      await this.refreshDiffs();
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // --- composer helpers -------------------------------------------------

  private async ensureFileCache(): Promise<{ path: string; name: string }[]> {
    if (this.fileCache) {
      return this.fileCache;
    }
    const uris = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}",
      1_000,
    );
    const folderPath = toServerPath(this.folder.uri.fsPath);
    this.fileCache = uris
      .map((uri) => toServerPath(uri.fsPath))
      .filter((p) => p.startsWith(folderPath))
      .map((p) => ({ path: p, name: pathBasename(p) }));
    return this.fileCache;
  }

  async searchFiles(requestId: string, query: string, sessionID?: string): Promise<void> {
    const files = await this.ensureFileCache();
    const q = query.toLowerCase();
    const scored = files
      .map((file) => ({ file, score: subsequenceScore(file.name.toLowerCase(), q) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((entry) => ({ path: entry.file.path, name: entry.file.name }));
    this.post({ kind: "fileResults", requestId, results: scored, sessionID });
  }

  async pickFiles(requestId: string, sessionID?: string): Promise<void> {
    const files = await this.ensureFileCache();
    const items = files.map((file) => ({
      label: file.name,
      description: relativeTo(file.path, toServerPath(this.folder.uri.fsPath)),
      picked: false,
      path: file.path,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: t("attachFilesPicker"),
      matchOnDescription: true,
    });
    this.post({
      kind: "pickedPaths",
      requestId,
      paths: (picked ?? []).map((item) => item.path),
      sessionID,
    });
  }

  async openCLI(): Promise<void> {
    const { resolveBinary } = await import("../server/resolve");
    const settings = vscode.workspace.getConfiguration("opencode");
    const resolved = await resolveBinary(settings.get<string>("path", ""));
    if (!resolved) {
      await vscode.window.showErrorMessage(t("cliNotFound"));
      return;
    }
    const terminal = vscode.window.createTerminal({
      name: "opencode",
      cwd: this.folder.uri,
    });
    terminal.show();
    terminal.sendText(`"${resolved.path}"`);
  }

  private cycleAgent(direction: 1 | -1): void {
    const agents = this.host.catalog.agents;
    if (agents.length === 0 || !this.sessionId) {
      return;
    }
    const index = agents.findIndex((a) => a.id === this.agent);
    const next = agents[(index + direction + agents.length) % agents.length];
    if (next) {
      void this.handleMessage({ kind: "setAgent", agent: next.id });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The diff status as a localized word for the diff editor's title. */
function diffStatusKey(status: FileDiffInfo["status"]): MessageKey {
  return `diffStatus.${status}` as MessageKey;
}

/** What identifies one round of a file's changes, for the dismissed map. */
function diffKey(diff: FileDiffInfo): string {
  return `${diff.status}:${diff.additions}:${diff.deletions}`;
}

/** Stream ordinals are 0-based positions among a message's same-kind parts. */
function ordinalOf(data: Record<string, unknown>): number {
  return typeof data.ordinal === "number" && data.ordinal >= 0 ? data.ordinal : 0;
}

/**
 * A form event's owning session. Most events carry a top-level `data.sessionID`,
 * but v2.3.0's `form.created` nests it inside `data.form.sessionID` only —
 * without the fallback the question card never appears live.
 */
export function formEventSession(data: Record<string, unknown>): string | undefined {
  const top = typeof data.sessionID === "string" ? data.sessionID : undefined;
  if (top) {
    return top;
  }
  const form = data.form as FormInfo | undefined;
  return typeof form?.sessionID === "string" ? form.sessionID : undefined;
}

function pathBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/**
 * The file a tab points at, whatever kind of tab it is: a plain text editor, a
 * custom editor such as the Markdown preview, or a notebook. Anything without
 * an on-disk file (settings UI, webviews, diffs) has nothing to cite.
 */
function tabFilePath(input: unknown): string | undefined {
  const uri =
    input instanceof vscode.TabInputText
      ? input.uri
      : input instanceof vscode.TabInputCustom
        ? input.uri
        : input instanceof vscode.TabInputNotebook
          ? input.uri
          : undefined;
  return uri?.scheme === "file" ? uri.fsPath : undefined;
}

function toolLine(tool: string, input: Record<string, unknown> | undefined): string {
  const candidates = ["file_path", "path", "command", "description", "pattern", "url"];
  for (const key of candidates) {
    const value = input?.[key];
    if (typeof value === "string" && value) {
      const short = value.length > 100 ? `${value.slice(0, 100)}…` : value;
      return `— ${short}`;
    }
  }
  return "";
}

function relativeTo(p: string, folder: string): string {
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith(folder)) {
    return normalized.slice(folder.length + 1);
  }
  return normalized;
}

/** Simple subsequence score; -1 means no match. */
function subsequenceScore(name: string, query: string): number {
  if (!query) {
    return 1;
  }
  let nameIndex = 0;
  let score = 0;
  for (const char of query) {
    const found = name.indexOf(char, nameIndex);
    if (found < 0) {
      return -1;
    }
    score += found === nameIndex ? 2 : 1;
    nameIndex = found + 1;
  }
  return score;
}
