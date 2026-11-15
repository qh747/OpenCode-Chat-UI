import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { OpencodeHost } from "../host";
import { toServerPath } from "../host";
import type {
  AssistantMessage,
  FileDiffInfo,
  MessageInfo,
  PermissionRequest,
  PromptFileAttachment,
  TokenUsage,
  UserMessage,
} from "../opencode/types";
import { promptAttachment, rangeAttachment, type StagedImage } from "../util/attachments";
import { reverseApply } from "../util/diffapply";
import { orderMessages } from "../util/messages";
import { resolveCommandAction } from "../util/commands";
import { deriveSessionStatus, groupSessionsByDate } from "../util/sessions";
import { GitStatusProvider } from "../git";
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
  private textBuffers = new Map<string, string>();
  private reasoningBuffers = new Map<string, string>();
  private pending: PermissionRequest[] = [];
  private diffs: FileDiffInfo[] = [];
  private dismissed = new Set<string>();
  private busy = false;
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
  private cost: number | undefined;
  private tokens: TokenUsage | undefined;
  private git: GitInfo = {};
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private permissionTimer: ReturnType<typeof setInterval> | undefined;
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
    };
    this.sinks.add(sink);
    return sink;
  }

  detachSink(sink: Sink): void {
    this.sinks.delete(sink);
  }

  async handleMessage(web: WebToHost): Promise<void> {
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
        this.stageImage(web.requestId, web.name, web.dataBase64, web.mime);
        break;
      case "rewindTo":
        await this.rewindTo(web.messageID);
        break;
      case "permissionReply":
        await this.replyPermission(web.requestID, web.decision);
        break;
      case "openDiff":
        await this.openDiff(web.file);
        break;
      case "keepFile":
        this.dismissed.add(web.file);
        this.broadcastDiffs();
        break;
      case "revertFile":
        await this.revertFile(web.file);
        break;
      case "searchFiles":
        await this.searchFiles(web.requestId, web.query);
        break;
      case "pickFiles":
        await this.pickFiles(web.requestId);
        break;
      case "openCLI":
        await this.openCLI();
        break;
      case "showLogs":
        await vscode.commands.executeCommand("opencode.showLogs");
        break;
      case "executePlan":
        await this.executePlan();
        break;
      case "cycleAgent":
        this.cycleAgent(web.direction);
        break;
      case "restartServer":
        await this.host.restart();
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
    this.post({
      kind: "state",
      state: this.host.currentState,
      version: this.host.server?.version,
      error: this.host.lastError,
      compatWarning: this.host.compatWarning,
    });
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
    try {
      const created = await client.createSession({ location: { directory: this.host.folderPath } });
      const sessionId = created.data.id;
      this.sessionId = sessionId;
      this.messages = [];
      this.textBuffers.clear();
      this.reasoningBuffers.clear();
      this.pending = [];
      this.diffs = [];
      this.dismissed.clear();
      this.busy = false;
      this.resetQueue();
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
    this.sessionId = id;
    this.pendingAgent = undefined;
    this.pendingModel = undefined;
    await this.context.workspaceState.update(this.storageKey(), id);
    this.messages = [];
    this.textBuffers.clear();
    this.reasoningBuffers.clear();
    this.pending = [];
    this.diffs = [];
    this.dismissed.clear();
    this.resetQueue();
    await this.fullResync();
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
    const promptText = links.length
      ? `${text}\n\n${links.map((link) => `参考链接: ${link.ref}`).join("\n")}`
      : text;
    this.dismissed.clear();
    this.busy = true;
    this.post({ kind: "busy", sessionID: this.sessionId, busy: true });
    this.startPermissionPolling();
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
  private resetQueue(): void {
    this.discardQueuedAttachments(this.pendingForce ? [...this.queue, this.pendingForce] : this.queue);
    this.queue = [];
    this.queuePaused = false;
    this.pendingForce = undefined;
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
    this.stopPermissionPolling();
    this.post({ kind: "busy", sessionID: this.sessionId, busy: false });
    if (this.queue.length > 0) {
      this.queuePaused = true;
      this.postQueue();
    }
    this.post({ kind: "error", message: errorMessage(error) });
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
      return { path, note: "(selection too long to auto-attach)" };
    }
    return {
      path,
      start: editor.selection.start.line + 1,
      end: editor.selection.end.line + 1,
    };
  }

  async executePlan(): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    await this.safeCall(() => client.setAgent(this.sessionId ?? "", "build"));
    this.agent = "build";
    this.post({ kind: "sessionMeta", sessionID: this.sessionId, agent: "build" });
    await this.send("Proceed with the plan.", []);
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
            this.post({ kind: "error", message: "Nothing to undo yet." });
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
  private stageImage(requestId: string, name: string, dataBase64: string, mime: string): void {
    const ref = `staged:${requestId}`;
    this.stagedImages.set(ref, {
      name: name || "image.png",
      mime: mime || "image/png",
      data: dataBase64,
    });
    this.post({ kind: "imageStaged", requestId, path: ref, name });
  }

  /** Rewind the session to just before the given message, reverting its file changes. */
  private async rewindTo(messageID: string): Promise<void> {
    const client = this.client();
    if (!client || !this.sessionId) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      "Rewind to before this message? Later messages are removed and their file changes are reverted.",
      { modal: true },
      "Rewind",
    );
    if (confirm !== "Rewind") {
      return;
    }
    await this.safeCall(async () => {
      await client.revertStage(this.sessionId ?? "", messageID);
      await client.revertCommit(this.sessionId ?? "");
      this.textBuffers.clear();
      this.reasoningBuffers.clear();
      this.dismissed.clear();
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
      const groups = groupSessionsByDate(page.data).map((group) => ({
        label: group.label,
        sessions: group.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          updated: s.time.updated,
          status: deriveSessionStatus(s, activeIDs, blockedIDs),
        })),
      }));
      this.post({ kind: "history", groups });
    });
  }

  private async renameSessionById(id: string, currentTitle?: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: "Session name",
      value: currentTitle ?? "",
    });
    if (name !== undefined) {
      await this.safeCall(() => this.client()?.patchSession(id, { title: name }));
    }
  }

  private async deleteSessionById(id: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage("Delete this session?", { modal: true }, "Delete");
    if (confirm === "Delete") {
      await this.safeCall(() => this.client()?.deleteSession(id));
      if (this.sessionId === id) {
        this.sessionId = undefined;
        this.messages = [];
        this.pending = [];
        this.diffs = [];
        this.busy = false;
        this.resetQueue();
        void this.context.workspaceState.update(this.storageKey(), undefined);
        this.postSnapshot();
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
            if (part.type === "text" && part.text) {
              lines.push(part.text, "");
            } else if (part.type === "reasoning" && part.text) {
              lines.push(`<details><summary>Thinking</summary>`, "", part.text, "", `</details>`, "");
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
      void vscode.window.showInformationMessage(`Session exported to ${target.fsPath}`);
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // --- event handling ---------------------------------------------------

  private handleEvent(event: { type: string; data: Record<string, unknown> }): void {
    const data = event.data as Record<string, string | number | undefined>;
    const eventSession = typeof data.sessionID === "string" ? data.sessionID : undefined;
    switch (event.type) {
      case "session.text.started":
        if (this.sessionId && eventSession === this.sessionId && typeof data.assistantMessageID === "string") {
          this.textBuffers.set(data.assistantMessageID, "");
          this.post({
            kind: "textStarted",
            sessionID: eventSession,
            messageID: data.assistantMessageID,
          });
        }
        break;
      case "session.text.delta":
        if (this.sessionId && eventSession === this.sessionId && typeof data.assistantMessageID === "string") {
          const delta = typeof data.delta === "string" ? data.delta : "";
          this.textBuffers.set(
            data.assistantMessageID,
            (this.textBuffers.get(data.assistantMessageID) ?? "") + delta,
          );
          this.post({
            kind: "textDelta",
            sessionID: eventSession,
            messageID: data.assistantMessageID,
            delta,
          });
        }
        break;
      case "session.reasoning.delta":
        if (this.sessionId && eventSession === this.sessionId && typeof data.assistantMessageID === "string") {
          this.reasoningBuffers.set(
            data.assistantMessageID,
            (this.reasoningBuffers.get(data.assistantMessageID) ?? "") +
              (typeof data.delta === "string" ? data.delta : ""),
          );
          this.post({
            kind: "reasoningDelta",
            sessionID: eventSession,
            messageID: data.assistantMessageID,
            delta: typeof data.delta === "string" ? data.delta : "",
          });
        }
        break;
      case "session.step.started":
      case "session.execution.started":
        if (eventSession === this.sessionId) {
          this.busy = true;
          this.post({ kind: "busy", sessionID: this.sessionId, busy: true });
        }
        break;
      case "session.idle":
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        if (eventSession === this.sessionId) {
          const wasBusy = this.busy;
          this.busy = false;
          this.post({ kind: "busy", sessionID: this.sessionId, busy: false });
          this.stopPermissionPolling();
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
          this.sessionId = undefined;
          this.messages = [];
          this.pending = [];
          this.diffs = [];
          this.busy = false;
          this.resetQueue();
          void this.context.workspaceState.update(this.storageKey(), undefined);
          this.postSnapshot();
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

  private async refreshMessages(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(async () => {
      const page = await client.listMessages(this.sessionId ?? "");
      // The v2 endpoint returns newest-first; the UI renders oldest-first.
      this.messages = orderMessages(page.data);
      this.post({ kind: "messages", sessionID: this.sessionId ?? "", messages: this.mergedMessages() });
    });
  }

  /** Apply live streaming buffers on top of fetched messages. */
  private mergedMessages(): MessageInfo[] {
    const merged: MessageInfo[] = this.messages.map((m) => m);
    for (const message of merged) {
      if (message.type !== "assistant") {
        continue;
      }
      const assistant = message as AssistantMessage;
      const buffer = this.textBuffers.get(assistant.id);
      if (buffer !== undefined && !assistant.finish) {
        const textParts = assistant.content.filter((c) => c.type === "text");
        if (textParts.length === 0) {
          assistant.content.push({ type: "text", text: buffer });
        } else {
          const last = textParts[textParts.length - 1];
          if (last && buffer.length > last.text.length) {
            last.text = buffer;
          }
        }
      }
      const reasoningBuffer = this.reasoningBuffers.get(assistant.id);
      if (reasoningBuffer !== undefined) {
        const reasoningParts = assistant.content.filter((c) => c.type === "reasoning");
        if (reasoningParts.length === 0) {
          assistant.content.push({ type: "reasoning", text: reasoningBuffer });
        } else {
          const last = reasoningParts[reasoningParts.length - 1];
          if (last && reasoningBuffer.length > last.text.length) {
            last.text = reasoningBuffer;
          }
        }
      }
    }
    return merged;
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
      this.pending = result.data.filter((p) => p.sessionID === this.sessionId);
      this.post({ kind: "permissions", sessionID: this.sessionId, pending: this.pending });
      if (this.pending.length === 0) {
        this.stopPermissionPolling();
      }
    });
  }

  private startPermissionPolling(): void {
    if (this.permissionTimer) {
      return;
    }
    this.permissionTimer = setInterval(() => void this.refreshPermissions(), 1_500);
  }

  private stopPermissionPolling(): void {
    if (this.permissionTimer) {
      clearInterval(this.permissionTimer);
      this.permissionTimer = undefined;
    }
  }

  private async refreshDiffs(): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    const client = this.client();
    if (!client) {
      return;
    }
    await this.safeCall(async () => {
      const result = await client.sessionDiff(this.sessionId ?? "");
      this.diffs = result.data;
      this.broadcastDiffs();
    });
  }

  private broadcastDiffs(): void {
    this.post({
      kind: "diffs",
      sessionID: this.sessionId,
      diffs: this.diffs.filter((d) => !this.dismissed.has(d.file)),
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
    await this.safeCall(async () => {
      const result = await client.getSession(this.sessionId ?? "");
      this.title = result.data.title;
      this.agent = result.data.agent;
      this.model = result.data.model;
      this.cost = result.data.cost;
      this.tokens = result.data.tokens;
      if (result.data.time.busy && !result.data.time.idle) {
        this.busy = true;
      }
      this.post({
        kind: "sessionMeta",
        sessionID: this.sessionId,
        title: this.title,
        agent: this.agent,
        model: this.model,
        busy: this.busy,
        cost: this.cost,
        tokens: this.tokens,
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
      this.refreshDiffs(),
    ]);
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
        messages: this.mergedMessages(),
        pending: this.pending,
        diffs: this.diffs.filter((d) => !this.dismissed.has(d.file)),
        catalog: this.host.catalog,
        cost: this.cost,
        tokens: this.tokens,
        workspacePath: this.folder.uri.fsPath,
        git: this.git,
        editors: this.editors,
      },
    });
  }

  private clearTimers(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.stopPermissionPolling();
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

  // --- diffs ------------------------------------------------------------

  private resolveFileUri(file: string): vscode.Uri {
    if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) {
      return vscode.Uri.file(file);
    }
    return vscode.Uri.joinPath(this.folder.uri, file);
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
    const title = `${pathBasename(file)} (${diff.status})`;
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
        const before = await this.beforeContent(diff, uri);
        if (diff.status === "deleted") {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(uri.path.slice(0, uri.path.lastIndexOf("/"))),
          );
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(before, "utf8"));
      }
      this.dismissed.add(file);
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

  async searchFiles(requestId: string, query: string): Promise<void> {
    const files = await this.ensureFileCache();
    const q = query.toLowerCase();
    const scored = files
      .map((file) => ({ file, score: subsequenceScore(file.name.toLowerCase(), q) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((entry) => ({ path: entry.file.path, name: entry.file.name }));
    this.post({ kind: "fileResults", requestId, results: scored });
  }

  async pickFiles(requestId: string): Promise<void> {
    const files = await this.ensureFileCache();
    const items = files.map((file) => ({
      label: file.name,
      description: relativeTo(file.path, toServerPath(this.folder.uri.fsPath)),
      picked: false,
      path: file.path,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Attach files as context",
      matchOnDescription: true,
    });
    this.post({
      kind: "pickedPaths",
      requestId,
      paths: (picked ?? []).map((item) => item.path),
    });
  }

  async openCLI(): Promise<void> {
    const { resolveBinary } = await import("../server/resolve");
    const settings = vscode.workspace.getConfiguration("opencode");
    const resolved = await resolveBinary(settings.get<string>("path", ""));
    if (!resolved) {
      await vscode.window.showErrorMessage(
        "opencode CLI not found. Install it (https://opencode.ai/docs) or set \"opencode.path\".",
      );
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
