import * as vscode from "vscode";
import { groupSessionsByDate } from "../util/sessions";
import { t } from "../util/i18n";
import type { OpencodeHost } from "../host";
import type { SessionInfo } from "../opencode/types";

export interface HistoryActions {
  open(id: string): void;
  rename(id: string, currentTitle: string | undefined): void;
  remove(id: string): void;
  fork(id: string): void;
  exportSession(id: string): void;
}

/**
 * History picker replacing the old sessions tree view: date-grouped
 * QuickPick; per-item buttons cover rename / fork / export / delete.
 */
export async function showHistoryPicker(host: OpencodeHost, actions: HistoryActions): Promise<void> {
  const client = host.client();
  if (!client) {
    void vscode.window.showInformationMessage(t("serverNotConnectedYet"));
    return;
  }
  const page = await client.listSessions({
    directory: host.folderPath,
    limit: 100,
    order: "desc",
    archived: false,
  });

  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = "Pick a session to load its history (hover for actions)";
  quickPick.matchOnDescription = true;

  type HistoryItem = vscode.QuickPickItem & { sessionId?: string };
  const items: HistoryItem[] = [];
  // Subagent sessions stay out of the QuickPick: it is a flat, keyboard-first
  // jump list, and folding structure into it would break arrow-key navigation.
  // The webview history menu is where the parent/child shape lives (Q20).
  const roots = page.data.filter((session) => session.parentID === undefined);
  for (const [label, list] of groupByDate(roots)) {
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    for (const session of list) {
      items.push({
        label: session.title || "Untitled",
        description: relativeTime(session.time.updated),
        detail: session.id,
        sessionId: session.id,
        buttons: [
          { iconPath: new vscode.ThemeIcon("edit"), tooltip: "Rename" },
          { iconPath: new vscode.ThemeIcon("copy"), tooltip: "Fork" },
          { iconPath: new vscode.ThemeIcon("export"), tooltip: "Export as Markdown" },
          { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Delete" },
        ],
      });
    }
  }
  quickPick.items = items;

  const sessionIdOf = (item: HistoryItem | undefined): string | undefined => item?.sessionId;

  quickPick.onDidAccept(() => {
    const sessionId = sessionIdOf(quickPick.selectedItems[0]);
    if (sessionId) {
      quickPick.hide();
      actions.open(sessionId);
    }
  });
  quickPick.onDidTriggerItemButton(({ item, button }) => {
    const sessionId = sessionIdOf(item as HistoryItem);
    if (!sessionId) {
      return;
    }
    quickPick.hide();
    if (button.tooltip === "Rename") {
      actions.rename(sessionId, item.label);
    } else if (button.tooltip === "Fork") {
      actions.fork(sessionId);
    } else if (button.tooltip === "Export as Markdown") {
      actions.exportSession(sessionId);
    } else if (button.tooltip === "Delete") {
      actions.remove(sessionId);
    }
  });
  quickPick.show();
}

function groupByDate(sessions: SessionInfo[]): [string, SessionInfo[]][] {
  return groupSessionsByDate(sessions).map((g) => [g.label, g.sessions] as [string, SessionInfo[]]);
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}
