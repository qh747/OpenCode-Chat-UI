import * as vscode from "vscode";
import { OpencodeClient } from "./opencode/client";
import { OpencodeEventStream, type EventStreamState } from "./opencode/events";
import type { AgentInfo, CommandInfo, ModelInfo, ModelRef, OEvent, SkillInfo } from "./opencode/types";
import { ServerManager, type ActiveServer, type ServerState } from "./server/manager";
import type { Catalog } from "./webview/protocol";

export interface HostOptions {
  context: vscode.ExtensionContext;
  folder: vscode.WorkspaceFolder;
  output: vscode.OutputChannel;
}

/**
 * Central orchestrator for one VS Code window: owns the server lifecycle,
 * the API client, the SSE stream, the model/agent catalog and cross-view
 * coordination signals. Views (sessions tree, chat panel) attach to it.
 */
export class OpencodeHost {
  readonly folderPath: string;
  private manager: ServerManager;
  private eventStream: OpencodeEventStream | undefined;
  private clientInstance: OpencodeClient | undefined;
  private catalogCache: Catalog = {
    agents: [],
    models: [],
    commands: [],
    skills: [],
    recentModels: [],
    favoriteModels: [],
  };

  private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
  readonly onState = this.stateEmitter.event;

  private readonly eventEmitter = new vscode.EventEmitter<OEvent>();
  readonly onEvent = this.eventEmitter.event;

  private readonly resyncEmitter = new vscode.EventEmitter<void>();
  readonly onResync = this.resyncEmitter.event;

  private readonly errorEmitter = new vscode.EventEmitter<string>();
  readonly onError = this.errorEmitter.event;

  private lastErrorDetail: string | undefined;
  private compatWarningDetail: string | undefined;

  constructor(private readonly options: HostOptions) {
    this.folderPath = toServerPath(options.folder.uri.fsPath);
    this.manager = this.buildManager();
    this.catalogCache.recentModels = this.options.context.workspaceState.get<ModelRef[]>(
      this.recentKey(),
      [],
    );
    this.catalogCache.favoriteModels = this.options.context.globalState.get<ModelRef[]>(
      "opencode.favoriteModels",
      [],
    );
  }

  private buildManager(): ServerManager {
    return new ServerManager({
      directory: this.options.folder.uri.fsPath,
      settings: this.readSettings(),
      logger: (line) => this.options.output.appendLine(line.trimEnd()),
      onState: (state, detail) => {
        if (state === "error" && detail) {
          this.lastErrorDetail = detail;
          this.errorEmitter.fire(detail);
        }
        if (state === "connected") {
          this.lastErrorDetail = undefined;
        }
        this.stateEmitter.fire(state);
      },
    });
  }

  private readSettings() {
    const config = vscode.workspace.getConfiguration("opencode");
    return {
      path: config.get<string>("path", "").trim(),
      serverUrl: config.get<string>("serverUrl", "").trim(),
      serverPassword: config.get<string>("serverPassword", ""),
    };
  }

  get currentState(): ServerState {
    return this.manager.currentState;
  }

  get server(): ActiveServer | undefined {
    return this.manager.active;
  }

  get catalog(): Catalog {
    return this.catalogCache;
  }

  client(): OpencodeClient | undefined {
    return this.clientInstance;
  }

  /** Last connection failure detail (cleared once connected again). */
  get lastError(): string | undefined {
    return this.lastErrorDetail;
  }

  /** Non-blocking warning when the connected server major version is untested. */
  get compatWarning(): string | undefined {
    return this.compatWarningDetail;
  }

  private recentKey(): string {
    return `opencode.recentModels:${this.folderPath}`;
  }

  /** Record a model selection as "recently used" (per workspace, max 5). */
  recordModelUsed(ref: ModelRef): void {
    const key = `${ref.providerID}/${ref.id}`;
    const previous = this.catalogCache.recentModels;
    const list = previous.filter((m) => `${m.providerID}/${m.id}` !== key);
    list.unshift({ providerID: ref.providerID, id: ref.id, variant: ref.variant });
    this.catalogCache.recentModels = list.slice(0, 5);
    void this.options.context.workspaceState.update(this.recentKey(), this.catalogCache.recentModels);
    if (this.catalogCache.recentModels.some((m) => `${m.providerID}/${m.id}` === key) !== previous.some((m) => `${m.providerID}/${m.id}` === key)) {
      // Only resync when the entry is new to the list (avoid churn per send).
      this.resyncEmitter.fire();
    }
  }

  /** Toggle a model favorite (global, shared across workspaces). */
  toggleFavoriteModel(ref: ModelRef): void {
    const key = `${ref.providerID}/${ref.id}`;
    const current = this.options.context.globalState.get<ModelRef[]>("opencode.favoriteModels", []);
    const exists = current.some((m) => `${m.providerID}/${m.id}` === key);
    const list = exists
      ? current.filter((m) => `${m.providerID}/${m.id}` !== key)
      : [...current, { providerID: ref.providerID, id: ref.id }];
    void this.options.context.globalState.update("opencode.favoriteModels", list);
    this.catalogCache.favoriteModels = list;
    this.resyncEmitter.fire();
  }

  log(line: string): void {
    this.options.output.appendLine(line);
  }

  /** Start (or restart) the server and wire up the event stream. */
  async start(): Promise<void> {
    await this.manager.dispose();
    this.eventStream?.stop();
    this.eventStream = undefined;
    this.clientInstance = undefined;
    this.manager = this.buildManager();
    try {
      const server = await this.manager.start();
      this.clientInstance = new OpencodeClient({
        baseUrl: server.url,
        password: server.password,
      });
      // Warn (but keep working) when the server major version is outside the
      // range this extension was verified against (v2.x API surface).
      const major = Number.parseInt(server.version, 10);
      this.compatWarningDetail = Number.isNaN(major) || major === 2
        ? undefined
        : `This extension targets the opencode v2 API but server reports v${server.version}. Things may break — consider updating the extension.`;
      this.eventStream = new OpencodeEventStream({
        baseUrl: server.url,
        password: server.password,
        directory: this.folderPath,
        onEvent: (event) => this.eventEmitter.fire(event),
        onState: (state: EventStreamState) => {
          if (state === "open") {
            void this.loadCatalog();
            this.resyncEmitter.fire();
          }
        },
      });
      this.eventStream.start();
      await this.loadCatalog();
      this.resyncEmitter.fire();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.lastErrorDetail = messageText;
      this.errorEmitter.fire(messageText);
    }
  }

  async restart(): Promise<void> {
    await this.start();
  }

  async loadCatalog(): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    // Each source loads independently so one failure doesn't wipe the rest.
    let agents: AgentInfo[] = [];
    let models: ModelInfo[] = [];
    try {
      const result = await client.agents(this.folderPath);
      agents = result.data.filter(
        (agent: AgentInfo) => agent.mode !== "subagent" && !agent.hidden,
      );
      if (agents.length === 0) {
        // Fallback: keep every visible agent rather than rendering no picker.
        agents = result.data.filter((agent: AgentInfo) => !agent.hidden);
      }
      this.log(`agents loaded: ${agents.length} selectable of ${result.data.length} total`);
    } catch (error) {
      this.log(`agents load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      models = (await client.models(this.folderPath)).data;
    } catch (error) {
      this.log(`models load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let commands: CommandInfo[] = [];
    try {
      commands = (await client.commands()).data;
    } catch (error) {
      this.log(`commands load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let skills: SkillInfo[] = [];
    try {
      skills = (await client.skills()).data;
    } catch (error) {
      this.log(`skills load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let defaultModel: ModelRef | undefined;
    try {
      defaultModel = await client.defaultModel(this.folderPath);
    } catch (error) {
      this.log(`default model load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const fallbackModel = models[0]
      ? { providerID: models[0].providerID, id: models[0].modelID }
      : undefined;
    this.catalogCache = {
      agents,
      models,
      commands,
      skills,
      recentModels: this.catalogCache.recentModels,
      favoriteModels: this.catalogCache.favoriteModels,
      defaultModel: defaultModel ?? fallbackModel,
    };
    this.resyncEmitter.fire();
  }

  async dispose(): Promise<void> {
    this.eventStream?.stop();
    this.eventStream = undefined;
    await this.manager.dispose();
    this.stateEmitter.dispose();
    this.eventEmitter.dispose();
    this.resyncEmitter.dispose();
    this.errorEmitter.dispose();
  }

  currentModelRef(): ModelRef | undefined {
    return this.catalogCache.defaultModel;
  }

  modelLabel(ref: ModelRef | undefined): string {
    if (!ref) {
      return "";
    }
    const model = this.catalogCache.models.find(
      (m: ModelInfo) => m.providerID === ref.providerID && m.modelID === ref.id,
    );
    return model?.name ?? `${ref.providerID}/${ref.id}`;
  }
}

/** Windows fsPaths use backslashes; the server accepts and normalizes both. */
export function toServerPath(fsPath: string): string {
  return fsPath.replace(/\\/g, "/");
}
