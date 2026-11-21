import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatController } from "./panel";
import type { WebToHost } from "./protocol";
import type { SettingsController } from "./settings-panel";
import type { SettingsWebToHost } from "./settings-protocol";

/** Which bundle a webview loads. */
export type WebviewMode = "chat" | "settings";

/** Shared builder for webview HTML (used by both the view and editor tabs). */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode: WebviewMode = "chat",
): string {
  const scriptName = mode === "settings" ? "settings.js" : "webview.js";
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", scriptName));
  const cssPath = path.join(extensionUri.fsPath, "dist", "webview.css");
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  const nonce = randomBytes(16).toString("hex");
  const title = mode === "settings" ? "OpenCode Server Configuration" : "OpenCode";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function bridgeWebview(
  controller: ChatController,
  webview: vscode.Webview,
  onDispose: () => void,
): vscode.Disposable {
  const sink = controller.attachSink(webview);
  const messageSub = webview.onDidReceiveMessage((message: WebToHost) => {
    // The surface reports whether the user is looking at it, so a completion
    // notice only appears when nobody is.
    if (message.kind === "focusChanged") {
      sink.focused = message.focused;
      return;
    }
    void controller.handleMessage(message);
  });
  return new vscode.Disposable(() => {
    messageSub.dispose();
    controller.detachSink(sink);
    onDispose();
  });
}

/** Provider for the `opencode.chat` webview view (sidebar / editor area). */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly controller: ChatController,
    private readonly extensionUri: vscode.Uri,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = buildWebviewHtml(view.webview, this.extensionUri);
    // 保留 bridgeWebview 的 Disposable（审计附带 3，session-stability 工单 03）：
    // 侧栏视图反复显示/销毁曾把返回值丢弃——sink 只增不减，长期使用积累
    // 失效广播目标。视图销毁时成对拆除（镜像 openChatTab 的先例）。
    const sub = bridgeWebview(this.controller, view.webview, () => {});
    view.onDidDispose(() => sub.dispose());
  }
}

/** Standalone editor tab surface for the same controller. */
export function openChatTab(
  controller: ChatController,
  extensionUri: vscode.Uri,
  context: vscode.ExtensionContext,
): void {
  const panel = vscode.window.createWebviewPanel(
    "opencode.chatTab",
    "OpenCode Chat",
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [extensionUri] },
  );
  panel.webview.html = buildWebviewHtml(panel.webview, extensionUri);
  const sub = bridgeWebview(controller, panel.webview, () => {});
  panel.onDidDispose(() => sub.dispose());
  const tabs = context.globalState.get<string[]>("opencode.openTabs", []);
  void context.globalState.update("opencode.openTabs", tabs);
}

/** One server config panel per window; opening it again focuses the existing one. */
let settingsPanel: vscode.WebviewPanel | undefined;

/** Standalone editor tab surface for the server config panel. */
export function openServerConfigTab(
  controller: SettingsController,
  extensionUri: vscode.Uri,
): void {
  if (settingsPanel) {
    settingsPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "opencode.settings",
    "OpenCode Server Configuration",
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [extensionUri] },
  );
  panel.webview.html = buildWebviewHtml(panel.webview, extensionUri, "settings");
  const sink = controller.attachSink(panel.webview);
  const messageSub = panel.webview.onDidReceiveMessage((message: SettingsWebToHost) => {
    void controller.handleMessage(message);
  });
  panel.onDidDispose(() => {
    messageSub.dispose();
    controller.detachSink(sink);
    settingsPanel = undefined;
  });
  settingsPanel = panel;
}
