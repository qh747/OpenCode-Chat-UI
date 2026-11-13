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
} from "../opencode/types";
import { reverseApply } from "../util/diffapply";
import type { HostToWeb, WebToHost } from "./protocol";

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
  private title: string | undefined;
  private agent: string | undefined;
  private model: { providerID: string; id: string } | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private permissionTimer: ReturnType<typeof setInterval> | undefined;
  private fileCache: { path: string; name: string }[] | undefined;
  private readonly beforeDocs = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly host: OpencodeHost,
    private readonly context: vscode.ExtensionContext,
    private readonly folder: vscode.WorkspaceFolder,
  ) {
    this.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent: (uri) => this.beforeDocs.get(uri.fragment) ?? "",
      }),
    );
    this.sessionId = this.context.workspaceState.get<string>(this.storageKey());

    this.subscriptions.push(
      this.host.onEvent((event) => this.handleEvent(event)),
      this.host.onResync(() => void this.fullResync()),
      this.host.onState(() => this.broadcastState()),
      this.host.onError((message) => {
        this.post({ kind: "state", state: "error", error: message });
        this.post({ kind: "error", message });
      }),
    );
    this.broadcastState();
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
        await this.send(web.text, web.files);
        break;
      case "abort":
        await this.safeCall(() => this.client()?.interrupt(this.sessionId ?? ""));
        break;
      case "newSession":
        await this.newSession();
        break;
      case "switchSession":
        await this.switchSession(web.id);
        break;
      case "setAgent":
        await this.safeCall(() => this.client()?.setAgent(this.sessionId ?? "", web.agent));
        break;
      case "setModel":
        await this.safeCall(() =>
          this.client()?.setModel(this.sessionId ?? "", { providerID: web.providerID, id: web.id }),
        );
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
    const client = this.host.client();
    if (!client) {
      this.post({ kind: "error", message: "OpenCode server is not connected yet." });
      return undefined;
    }
    return client;
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
    this.post({ kind: "state", state: this.host.currentState, version: this.host.server?.version });
  }

  private async safeCall(fn: () => unknown): Promise<void> {
    try {
      await Promise.resolve(fn());
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  // --- session lifecycle ---------------------------------------------

  async newSession(): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    try {
      const created = await client.createSession({ location: { directory: this.host.folderPath } });
      this.sessionId = created.data.id;
      this.messages = [];
      this.textBuffers.clear();
      this.reasoningBuffers.clear();
      this.pending = [];
      this.diffs = [];
      this.dismissed.clear();
      this.busy = false;
      this.title = created.data.title;
      this.agent = created.data.agent;
      this.model = created.data.model;
      await this.context.workspaceState.update(this.storageKey(), this.sessionId);
      await this.refreshSessionMeta();
      this.postSnapshot();
    } catch (error) {
      this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async switchSession(id: string): Promise<void> {
    this.sessionId = id;
    await this.context.workspaceState.update(this.storageKey(), id);
    this.messages = [];
    this.textBuffers.clear();
    this.reasoningBuffers.clear();
    this.pending = [];
    this.diffs = [];
    this.dismissed.clear();
    await this.fullResync();
    await vscode.commands.executeCommand("opencode.chat.focus");
  }

  // --- messaging ------------------------------------------------------

  async send(text: string, files: string[]): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    if (!this.sessionId) {
      try {
        const created = await client.createSession({ location: { directory: this.host.folderPath } });
        this.sessionId = created.data.id;
        await this.context.workspaceState.update(this.storageKey(), this.sessionId);
      } catch (error) {
        this.post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const attachments: PromptFileAttachment[] = files.map((uri) => ({
      uri,
      name: pathBasename(uri),
    }));
    const autoAttach = vscode.workspace
      .getConfiguration("opencode")
      .get<boolean>("context.autoAttachSelection", true);
    if (autoAttach) {
      const selection = this.activeSelection();
      if (selection && !files.includes(selection.uri)) {
        attachments.push({
          uri: selection.uri,
          name: pathBasename(selection.uri),
          description: selection.range,
        });
      }
    }
    this.dismissed.clear();
    this.busy = true;
    this.post({ kind: "busy", sessionID: this.sessionId, busy: true });
    this.startPermissionPolling();
    await this.safeCall(() => client.prompt(this.sessionId ?? "", { text, files: attachments }));
  }

  private activeSelection(): { uri: string; range: string } | undefined {
    const max = vscode.workspace
      .getConfiguration("opencode")
      .get<number>("context.maxSelectionLength", 2000);
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return undefined;
    }
    const uri = toServerPath(editor.document.uri.fsPath);
    const folderPath = toServerPath(this.folder.uri.fsPath);
    if (!uri.startsWith(folderPath)) {
      return undefined;
    }
    if (editor.document.getText(editor.selection).length > max) {
      return { uri, range: "(selection too long to auto-attach)" };
    }
    const start = editor.selection.start.line + 1;
    const end = editor.selection.end.line + 1;
    return { uri, range: `L${start}-L${end}` };
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
          this.busy = false;
          this.post({ kind: "busy", sessionID: this.sessionId, busy: false });
          this.stopPermissionPolling();
          this.scheduleMessagesRefresh(0);
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
          const model = data.model as { providerID?: string; id?: string };
          if (model.providerID && model.id) {
            this.model = { providerID: model.providerID, id: model.id };
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
      this.messages = page.data;
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
      const result = await client.pendingPermissions();
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
        messages: this.mergedMessages(),
        pending: this.pending,
        diffs: this.diffs.filter((d) => !this.dismissed.has(d.file)),
        catalog: this.host.catalog,
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

function pathBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
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
