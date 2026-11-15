import * as vscode from "vscode";
import * as fs from "node:fs";
import type { OpencodeHost } from "../host";
import {
  globalConfigDir,
  parseConfig,
  resolveConfigFile,
  updateConfigText,
  valueAtPath,
  type ConfigScope,
  type ConfigTarget,
} from "../util/opencode-config";
import { SERVER_SETTINGS, findSettingsItem, normalizeItemValue } from "../util/settings-items";
import { getLocale, t } from "../util/i18n";
import type {
  SettingsChoice,
  SettingsHostToWeb,
  SettingsItemState,
  SettingsWebToHost,
} from "./settings-protocol";

interface SettingsSink {
  post(message: SettingsHostToWeb): void;
}

/**
 * Drives the server config panel. It owns the opencode server's config file:
 * the panel shows what is currently in effect and writes back to whichever
 * scope a row belongs to. The extension's own preferences are VS Code settings
 * and are edited on the native settings page, not here.
 */
export class SettingsController implements vscode.Disposable {
  private sink: SettingsSink | undefined;
  private scope: ConfigScope = "global";
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly host: OpencodeHost,
    private readonly folder: vscode.WorkspaceFolder,
  ) {
    this.subscriptions.push(
      this.host.onEvent((event) => {
        // The server reloads its config on its own; re-read so the panel shows
        // what is in effect now.
        if (event.type === "config.updated") {
          void this.push();
        }
      }),
    );
  }

  dispose(): void {
    for (const sub of this.subscriptions.splice(0)) {
      sub.dispose();
    }
  }

  attachSink(webview: vscode.Webview): SettingsSink {
    const sink: SettingsSink = { post: (message) => void webview.postMessage(message) };
    this.sink = sink;
    return sink;
  }

  detachSink(sink: SettingsSink): void {
    if (this.sink === sink) {
      this.sink = undefined;
    }
  }

  async handleMessage(web: SettingsWebToHost): Promise<void> {
    switch (web.kind) {
      case "ready":
        await this.push();
        break;
      case "setServer":
        await this.setServer(web.id, web.value, web.reset === true);
        break;
      case "setScope":
        this.scope = web.scope;
        await this.push();
        break;
      case "openConfigFile":
        await this.openConfigFile();
        break;
    }
  }

  // --- writes ------------------------------------------------------------

  private async setServer(id: string, value: unknown, reset: boolean): Promise<void> {
    const item = findSettingsItem(id);
    if (!item?.configPath) {
      return;
    }
    try {
      if (id === "shell") {
        await this.writeShell(reset ? null : value);
      } else {
        await this.writeConfigValue(item.configPath, reset ? undefined : value);
      }
      this.post({ kind: "settingsSaved", id });
      await this.push();
    } catch (error) {
      this.post({ kind: "settingsError", message: errorMessage(error) });
    }
  }

  /** `shell` is the one key the server accepts over HTTP. */
  private async writeShell(value: unknown): Promise<void> {
    const client = this.host.client();
    if (!client) {
      throw new Error(t("shellWriteNoServer"));
    }
    const shell = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    await client.updateShell(shell);
  }

  private async writeConfigValue(keyPath: string[], value: unknown): Promise<void> {
    const target = this.scopeTarget();
    const text = target.missing ? "{}" : await fs.promises.readFile(target.file, "utf8");
    const next = updateConfigText(text, keyPath, value);
    await fs.promises.mkdir(target.dir, { recursive: true });
    await fs.promises.writeFile(target.file, next, "utf8");
  }

  private async openConfigFile(): Promise<void> {
    const target = this.scopeTarget();
    if (target.missing) {
      this.post({
        kind: "settingsError",
        message: t("noConfigFileYet"),
      });
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.file));
    await vscode.window.showTextDocument(doc);
  }

  // --- reads -------------------------------------------------------------

  private async push(): Promise<void> {
    const sink = this.sink;
    if (!sink) {
      return;
    }
    const target = this.scopeTarget();
    const server = await this.serverStates();
    sink.post({
      kind: "settings",
      locale: getLocale(),
      items: server.items,
      scope: this.scope,
      targetPath: target.file,
      targetMissing: target.missing,
      error: server.error,
      version: this.host.server?.version,
      connected: this.host.currentState === "connected",
      externalServer: this.isExternalServer(),
      models: this.modelChoices(),
      agents: this.agentChoices(),
      shells: await this.shellChoices(),
    });
  }

  private async serverStates(): Promise<{ items: SettingsItemState[]; error?: string }> {
    const dataByFile = new Map<string, Record<string, unknown>>();
    const states: SettingsItemState[] = [];
    let error: string | undefined;
    for (const item of SERVER_SETTINGS) {
      const target = this.targetFor(item.globalOnly === true);
      let data = dataByFile.get(target.file);
      if (!data) {
        const read = await this.readConfigData(target);
        data = read.data;
        error = error ?? read.error;
        dataByFile.set(target.file, data);
      }
      const value = item.configPath ? valueAtPath(data, item.configPath) : undefined;
      const dynamic = this.dynamicDefault(item.id);
      states.push({
        id: item.id,
        value: value === undefined ? dynamic.defaultValue : normalizeItemValue(item.id, value),
        explicit: value !== undefined,
        defaultValue: dynamic.defaultValue,
        defaultText: dynamic.defaultText,
      });
    }
    return { items: states, error };
  }

  private async readConfigData(target: ConfigTarget): Promise<{ data: Record<string, unknown>; error?: string }> {
    if (target.missing) {
      return { data: {} };
    }
    try {
      const text = await fs.promises.readFile(target.file, "utf8");
      const parsed = parseConfig(text);
      if (!parsed.ok) {
        return { data: {}, error: `${target.file}: ${parsed.error}` };
      }
      return { data: parsed.data };
    } catch (error) {
      return { data: {}, error: errorMessage(error) };
    }
  }

  /** Defaults the server does not document statically. */
  private dynamicDefault(id: string): { defaultValue?: unknown; defaultText?: string } {
    if (id === "model") {
      const ref = this.host.catalog.defaultModel;
      if (!ref) {
        return {};
      }
      const label = this.host.modelLabel(ref);
      return { defaultValue: `${ref.providerID}/${ref.id}`, defaultText: label };
    }
    if (id === "default_agent") {
      return { defaultValue: "build", defaultText: "build" };
    }
    return {};
  }

  private modelChoices(): SettingsChoice[] {
    return this.host.catalog.models.map((model) => ({
      id: `${model.providerID}/${model.modelID}`,
      label: model.name,
    }));
  }

  private agentChoices(): SettingsChoice[] {
    return this.host.catalog.agents.map((agent) => ({ id: agent.id, label: agent.name }));
  }

  /** The server's shell candidates; the entry shape is not pinned down. */
  private async shellChoices(): Promise<SettingsChoice[]> {
    const client = this.host.client();
    if (!client) {
      return [];
    }
    try {
      const entries = await client.shells();
      return entries.map((entry) => toShellChoice(entry)).filter((choice): choice is SettingsChoice => !!choice);
    } catch {
      return [];
    }
  }

  // --- paths -------------------------------------------------------------

  /** The file the current scope edits. */
  private scopeTarget(): ConfigTarget {
    return this.targetFor(this.scope === "global");
  }

  private targetFor(global: boolean): ConfigTarget {
    return global
      ? resolveConfigFile(globalConfigDir())
      : resolveConfigFile(this.folder.uri.fsPath);
  }

  private isExternalServer(): boolean {
    return vscode.workspace.getConfiguration("opencode").get<string>("serverUrl", "").trim().length > 0;
  }

  private post(message: SettingsHostToWeb): void {
    this.sink?.post(message);
  }
}

/** A shell entry, whatever shape the server sends it in. */
function toShellChoice(entry: unknown): SettingsChoice | undefined {
  if (typeof entry === "string") {
    return { id: entry, label: entry };
  }
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const id = record.value ?? record.path ?? record.id ?? record.command;
  if (typeof id !== "string" || id.length === 0) {
    return undefined;
  }
  const label = record.label ?? record.name ?? record.path ?? id;
  return { id, label: typeof label === "string" ? label : id };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
