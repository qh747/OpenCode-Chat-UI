import * as vscode from "vscode";
import { OpencodeHost } from "./host";
import { ChatController } from "./webview/panel";
import { SettingsController } from "./webview/settings-panel";
import { ChatViewProvider, openChatTab, openServerConfigTab } from "./webview/view";
import { resolveLocale, setLocale, t } from "./util/i18n";
import { showHistoryPicker } from "./views/historyPicker";
import type { SessionInfo } from "./opencode/types";

export function activate(context: vscode.ExtensionContext): void {
  setLocale(resolveLocale(vscode.env.language));
  const output = vscode.window.createOutputChannel("OpenCode");
  context.subscriptions.push(output);

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    output.appendLine("No workspace folder open; OpenCode stays idle.");
    registerUiOnlyCommands(context, output);
    return;
  }

  const host = new OpencodeHost({ context, folder, output });
  const chat = new ChatController(host, context, folder, output);
  const settings = new SettingsController(host, folder);

  context.subscriptions.push(
    host,
    chat,
    settings,
    vscode.window.registerWebviewViewProvider("opencode.chat", new ChatViewProvider(chat, context.extensionUri), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Status bar: connection indicator (click focuses the chat).
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  const updateStatus = () => {
    const state = host.currentState;
    if (state === "connected") {
      statusItem.text = "$(check) OpenCode";
      statusItem.tooltip = `OpenCode v${host.server?.version ?? "?"} — ${host.server?.url ?? ""}`;
      statusItem.backgroundColor = undefined;
    } else if (state === "starting") {
      statusItem.text = "$(loading~spin) OpenCode";
      statusItem.tooltip = "Starting opencode server…";
    } else if (state === "error") {
      statusItem.text = "$(error) OpenCode";
      statusItem.tooltip = "opencode server failed — click to show logs";
      statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else {
      statusItem.text = "$(circle-slash) OpenCode";
      statusItem.tooltip = "opencode server stopped";
    }
  };
  updateStatus();
  host.onState(updateStatus);
  statusItem.command = "opencode.openChat";
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Start the server immediately; errors surface via status bar and chat.
  void host.start();

  const showSessionActions = {
    open: (id: string) => {
      void chat.switchSession(id);
    },
    rename: (id: string, currentTitle: string | undefined) => {
      void renameSessionFlow(host, id, currentTitle);
    },
    remove: (id: string) => {
      void deleteSessionFlow(host, id);
    },
    fork: (id: string) => {
      void chat.forkSession(id);
    },
    exportSession: (id: string) => {
      void chat.exportSession(id);
    },
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.newSession", async () => {
      await chat.newSession();
      await vscode.commands.executeCommand("opencode.chat.focus");
    }),
    vscode.commands.registerCommand("opencode.openChat", async (sessionId?: string) => {
      if (typeof sessionId === "string" && sessionId) {
        await chat.switchSession(sessionId);
      }
      if (preferredLocation() === "editor") {
        openChatTab(chat, context.extensionUri, context);
        return;
      }
      await vscode.commands.executeCommand("opencode.chat.focus");
    }),
    vscode.commands.registerCommand("opencode.openChatTab", () =>
      openChatTab(chat, context.extensionUri, context),
    ),
    vscode.commands.registerCommand("opencode.history", async () => {
      await showHistoryPicker(host, showSessionActions);
    }),
    vscode.commands.registerCommand("opencode.showLogs", () => output.show(true)),
    vscode.commands.registerCommand("opencode.restartServer", async () => {
      await host.restart();
    }),
    vscode.commands.registerCommand("opencode.openCLI", () => void chat.openCLI()),
    vscode.commands.registerCommand("opencode.openSettings", () => openNativeSettings(context)),
    vscode.commands.registerCommand("opencode.openServerConfig", () =>
      openServerConfigTab(settings, context.extensionUri),
    ),
  );

  // Auto-restart when connection-relevant settings change; UI settings are
  // re-pushed to the webviews instead.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("opencode.path") ||
        event.affectsConfiguration("opencode.serverUrl")
      ) {
        void host.restart();
      }
      if (
        event.affectsConfiguration("opencode.composer.submitKey") ||
        event.affectsConfiguration("opencode.composer.showContextBar") ||
        event.affectsConfiguration("opencode.diffList.maxVisibleRows")
      ) {
        chat.refreshUiSettings();
      }
    }),
  );

  if (vscode.workspace.getConfiguration("opencode").get<boolean>("startup.autoOpen", false)) {
    void vscode.commands.executeCommand("opencode.openChat");
  }
}

/**
 * Opens VS Code's native settings page filtered to this extension. The id must
 * come from the running extension (publisher + name in package.json); a
 * hardcoded one goes stale whenever either is renamed and VS Code then shows
 * "No settings found".
 */
function openNativeSettings(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${context.extension.id}`);
}

function preferredLocation(): "sidebar" | "editor" {
  return vscode.workspace
    .getConfiguration("opencode")
    .get<"sidebar" | "editor">("ui.preferredLocation", "sidebar");
}

async function renameSessionFlow(host: OpencodeHost, id: string, currentTitle: string | undefined): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: t("sessionNamePrompt"),
    value: currentTitle ?? "",
  });
  if (name !== undefined) {
    await host.client()?.patchSession(id, { title: name });
  }
}

async function deleteSessionFlow(host: OpencodeHost, id: string): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    t("deleteSessionConfirm"),
    { modal: true },
    t("deleteButton"),
  );
  if (confirm === t("deleteButton")) {
    await host.client()?.deleteSession(id);
  }
}

function registerUiOnlyCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.showLogs", () => output.show(true)),
    vscode.commands.registerCommand("opencode.newSession", () => {
      void vscode.window.showInformationMessage(t("noWorkspace"));
    }),
    vscode.commands.registerCommand("opencode.openChat", () => {
      void vscode.window.showInformationMessage(t("noWorkspace"));
    }),
    vscode.commands.registerCommand("opencode.openChatTab", () => {
      void vscode.window.showInformationMessage(t("noWorkspace"));
    }),
    vscode.commands.registerCommand("opencode.history", () => {
      void vscode.window.showInformationMessage(t("noWorkspace"));
    }),
    vscode.commands.registerCommand("opencode.restartServer", () => undefined),
    vscode.commands.registerCommand("opencode.openCLI", () => undefined),
    // The native settings page needs no workspace folder, unlike the rest.
    vscode.commands.registerCommand("opencode.openSettings", () => openNativeSettings(context)),
    vscode.commands.registerCommand("opencode.openServerConfig", () => {
      void vscode.window.showInformationMessage(t("noWorkspace"));
    }),
  );
}

export function deactivate(): void {
  /* host disposal happens via context.subscriptions */
}

// SessionInfo re-exported for command argument typing in tests/tools.
export type { SessionInfo };
