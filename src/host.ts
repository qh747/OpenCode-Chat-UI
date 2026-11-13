import * as vscode from "vscode";
import { OpencodeClient } from "./opencode/client";
import { OpencodeEventStream, type EventStreamState } from "./opencode/events";
import type { AgentInfo, ModelInfo, ModelRef, OEvent } from "./opencode/types";
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
  private catalogCache: Catalog = { agents: [], models: [] };

  private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
  readonly onState = this.stateEmitter.event;

  private readonly eventEmitter = new vscode.EventEmitter<OEvent>();
  readonly onEvent = this.eventEmitter.event;

  private readonly resyncEmitter = new vscode.EventEmitter<void>();
  readonly onResync = this.resyncEmitter.event;

  private readonly errorEmitter = new vscode.EventEmitter<string>();
  readonly onError = this.errorEmitter.event;

  constructor(private readonly options: HostOptions) {
    this.folderPath = toServerPath(options.folder.uri.fsPath);
    this.manager = this.buildManager();
  }

  private buildManager(): ServerManager {
    return new ServerManager({
      directory: this.options.folder.uri.fsPath,
      settings: this.readSettings(),
      logger: (line) => this.options.output.appendLine(line.trimEnd()),
      onState: (state, detail) => {
        if (state === "error" && detail) {
          this.errorEmitter.fire(detail);
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
    try {
      const [agentsRes, modelsRes, defaultModel] = await Promise.all([
        client.agents(),
        client.models(),
        client.defaultModel(),
      ]);
      const agents = agentsRes.data.filter(
        (agent: AgentInfo) => agent.mode !== "subagent" && !agent.hidden,
      );
      const models = modelsRes.data;
      const fallback = models[0]
        ? { providerID: models[0].providerID, id: models[0].modelID }
        : undefined;
      this.catalogCache = { agents, models, defaultModel: defaultModel ?? fallback };
      this.resyncEmitter.fire();
    } catch (error) {
      this.log(`catalog load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
