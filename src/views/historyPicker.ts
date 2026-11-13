import * as vscode from "vscode";
import type { OpencodeHost } from "../host";
import type { SessionInfo } from "../opencode/types";

export interface HistoryActions {
  open(id: string): void;
  rename(id: string, currentTitle: string | undefined): void;
  remove(id: string): void;
  fork(id: string): void;
  exportSession(id: string): void;
}

const GROUP_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  month: "Last 30 days",
  older: "Earlier",
};

/**
 * History picker replacing the old sessions tree view: date-grouped
 * QuickPick; per-item buttons cover rename / fork / export / delete.
 */
export async function showHistoryPicker(host: OpencodeHost, actions: HistoryActions): Promise<void> {
  const client = host.client();
  if (!client) {
    void vscode.window.showInformationMessage("OpenCode server is not connected yet.");
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
  for (const [label, list] of groupByDate(page.data)) {
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
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const age = now - session.time.updated;
    let key: string;
    if (age < dayMs && new Date(session.time.updated).getDate() === new Date(now).getDate()) {
      key = "today";
    } else if (age < 2 * dayMs) {
      key = "yesterday";
    } else if (age < 7 * dayMs) {
      key = "week";
    } else if (age < 30 * dayMs) {
      key = "month";
    } else {
      key = "older";
    }
    const list = buckets.get(key) ?? [];
    list.push(session);
    buckets.set(key, list);
  }
  const order = ["today", "yesterday", "week", "month", "older"];
  const result: [string, SessionInfo[]][] = [];
  for (const key of order) {
    const label = GROUP_LABELS[key];
    const list = buckets.get(key);
    if (label && list && list.length > 0) {
      result.push([label, list]);
    }
  }
  return result;
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
