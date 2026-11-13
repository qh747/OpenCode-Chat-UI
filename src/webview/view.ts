import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ChatController } from "./panel";
import type { WebToHost } from "./protocol";

/** Shared builder for webview HTML (used by both the view and editor tabs). */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const cssPath = path.join(extensionUri.fsPath, "dist", "webview.css");
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
  const nonce = randomBytes(16).toString("hex");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode</title>
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
    view.onDidDispose(() => {
      /* sink disposed via registered disposable */
    });
    bridgeWebview(this.controller, view.webview, () => {});
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
