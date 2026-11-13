import * as vscode from "vscode";
import type { OpencodeHost } from "../host";
import type { SessionInfo } from "../opencode/types";

interface GroupNode {
  kind: "group";
  label: string;
}
interface SessionNode {
  kind: "session";
  session: SessionInfo;
}
type TreeNode = GroupNode | SessionNode;

const GROUP_KEYS = ["today", "yesterday", "week", "month", "older"] as const;
const GROUP_LABELS: Record<(typeof GROUP_KEYS)[number], string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  month: "Last 30 days",
  older: "Earlier",
};

/** Sessions tree: date-grouped list with open/rename/delete actions. */
export class SessionsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private sessions: SessionInfo[] = [];
  private loadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: OpencodeHost) {
    host.onState((state) => {
      if (state === "connected") {
        void this.load();
      } else {
        this.sessions = [];
        this.emitter.fire();
      }
    });
    host.onResync(() => this.scheduleLoad());
    host.onEvent((event) => {
      if (event.type.startsWith("session.")) {
        this.scheduleLoad();
      }
    });
    void this.load();
  }

  dispose(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
    }
    this.emitter.dispose();
  }

  private scheduleLoad(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
    }
    this.loadTimer = setTimeout(() => void this.load(), 400);
  }

  async load(): Promise<void> {
    const client = this.host.client();
    if (!client) {
      this.sessions = [];
      this.emitter.fire();
      return;
    }
    try {
      const page = await client.listSessions({
        directory: this.host.folderPath,
        limit: 100,
        order: "desc",
        archived: false,
      });
      this.sessions = page.data;
    } catch (error) {
      this.host.log(`sessions load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.emitter.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "group") {
      // Collapsed by default (CommandCode-style): click a group to reveal and
      // pick a session; its history only loads when chosen.
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = "opencode.group";
      return item;
    }
    const session = node.session;
    const item = new vscode.TreeItem(session.title || "Untitled");
    item.contextValue = "opencode.session";
    item.description = relativeTime(session.time.updated);
    item.tooltip = new vscode.MarkdownString(
      `${session.title || "Untitled"}\n\n- Updated: ${new Date(session.time.updated).toLocaleString()}\n- Cost: $${session.cost.toFixed(4)}`,
    );
    if (session.time.busy && !session.time.idle) {
      item.iconPath = new vscode.ThemeIcon("loading~spin");
    } else {
      item.iconPath = new vscode.ThemeIcon("comment");
    }
    item.command = {
      command: "opencode.openChat",
      title: "Open Session",
      arguments: [session.id],
    };
    item.id = session.id;
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return buildGroups(this.sessions).map(([key]) => ({ kind: "group", label: GROUP_LABELS[key] }) as GroupNode);
    }
    const groups = buildGroups(this.sessions);
    const label = element.kind === "group" ? element.label : "";
    const key = (Object.keys(GROUP_LABELS) as (typeof GROUP_KEYS)[number][]).find(
      (k) => GROUP_LABELS[k] === label,
    );
    if (!key) {
      return [];
    }
    const group = groups.find(([k]) => k === key);
    return group ? group[1].map((session) => ({ kind: "session", session }) as SessionNode) : [];
  }
}

function buildGroups(sessions: SessionInfo[]): [(typeof GROUP_KEYS)[number], SessionInfo[]][] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<(typeof GROUP_KEYS)[number], SessionInfo[]>();
  for (const session of sessions) {
    const age = now - session.time.updated;
    let key: (typeof GROUP_KEYS)[number];
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
  return GROUP_KEYS.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => [
    key,
    buckets.get(key) as SessionInfo[],
  ]);
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
