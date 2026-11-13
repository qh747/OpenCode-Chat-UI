import * as vscode from "vscode";
import { OpencodeHost } from "./host";
import { ChatController } from "./webview/panel";
import { ChatViewProvider, openChatTab } from "./webview/view";
import { showHistoryPicker } from "./views/historyPicker";
import type { SessionInfo } from "./opencode/types";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode");
  context.subscriptions.push(output);

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    output.appendLine("No workspace folder open; OpenCode stays idle.");
    registerUiOnlyCommands(context, output);
    return;
  }

  const host = new OpencodeHost({ context, folder, output });
  const chat = new ChatController(host, context, folder);

  context.subscriptions.push(
    host,
    chat,
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
  );

  // Auto-restart when connection-relevant settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("opencode.path") ||
        event.affectsConfiguration("opencode.serverUrl") ||
        event.affectsConfiguration("opencode.serverPassword")
      ) {
        void host.restart();
      }
    }),
  );
}

async function renameSessionFlow(host: OpencodeHost, id: string, currentTitle: string | undefined): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Session name",
    value: currentTitle ?? "",
  });
  if (name !== undefined) {
    await host.client()?.patchSession(id, { title: name });
  }
}

async function deleteSessionFlow(host: OpencodeHost, id: string): Promise<void> {
  const confirm = await vscode.window.showWarningMessage("Delete this session?", { modal: true }, "Delete");
  if (confirm === "Delete") {
    await host.client()?.deleteSession(id);
  }
}

function registerUiOnlyCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.showLogs", () => output.show(true)),
    vscode.commands.registerCommand("opencode.newSession", () => {
      void vscode.window.showInformationMessage("OpenCode: open a workspace folder first.");
    }),
    vscode.commands.registerCommand("opencode.openChat", () => {
      void vscode.window.showInformationMessage("OpenCode: open a workspace folder first.");
    }),
    vscode.commands.registerCommand("opencode.openChatTab", () => {
      void vscode.window.showInformationMessage("OpenCode: open a workspace folder first.");
    }),
    vscode.commands.registerCommand("opencode.history", () => {
      void vscode.window.showInformationMessage("OpenCode: open a workspace folder first.");
    }),
    vscode.commands.registerCommand("opencode.restartServer", () => undefined),
    vscode.commands.registerCommand("opencode.openCLI", () => undefined),
  );
}

export function deactivate(): void {
  /* host disposal happens via context.subscriptions */
}

// SessionInfo re-exported for command argument typing in tests/tools.
export type { SessionInfo };
