import * as vscode from "vscode";
import * as fs from "node:fs";
import * as nodePath from "node:path";

/** Minimal shape of the built-in git extension API that we consume. */
interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    indexChanges: { uri: vscode.Uri }[];
    workingTreeChanges: { uri: vscode.Uri }[];
  };
  onDidChange: vscode.Event<void>;
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository?: vscode.Event<GitRepository>;
  onDidCloseRepository?: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

export interface GitStatus {
  branch?: string;
  dirty: boolean;
}

/**
 * Branch and dirty state of the workspace folder. Uses VS Code's built-in git
 * extension when it is available, and falls back to reading `.git/HEAD`
 * directly so the branch still shows up when the git extension is disabled or
 * has not opened the repository.
 */
export class GitStatusProvider implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<GitStatus>();
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private repo: GitRepository | undefined;
  private repoListener: vscode.Disposable | undefined;
  private status: GitStatus = { dirty: false };

  constructor(
    private readonly folder: vscode.WorkspaceFolder,
    private readonly log?: (line: string) => void,
  ) {
    this.disposables.push(this.emitter);
    // Read .git/HEAD synchronously so the branch is known before the first
    // webview render; the git extension may only report it a tick later.
    this.status = this.fallback();
    // connect 全程兜底：git API 形态变化等意外失败不能以未捕获错误的形式
    // 冒泡到扩展宿主（扩展运行时状态会记录为 uncaught error）。
    void this.connect().catch((error: unknown) => {
      this.log?.(`git: connection failed — ${error instanceof Error ? error.message : String(error)}`);
      this.publish(this.fallback());
    });
  }

  get current(): GitStatus {
    return this.status;
  }

  dispose(): void {
    this.repoListener?.dispose();
    for (const sub of this.disposables.splice(0)) {
      sub.dispose();
    }
  }

  private async connect(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
      this.log?.("git: the vscode.git extension is not available");
      this.publish(this.fallback());
      return;
    }
    let api: GitApi;
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      api = exports.getAPI(1);
    } catch (error) {
      this.log?.(`git: could not read the git API — ${error instanceof Error ? error.message : String(error)}`);
      this.publish(this.fallback());
      return;
    }
    // Listen before scanning so a repository opened in between is not missed.
    api.onDidOpenRepository?.((repo) => {
      if (this.covers(repo?.rootUri?.fsPath ?? "")) {
        this.log?.(`git: repository opened at ${repo.rootUri.fsPath}`);
        this.bind(repo);
      }
    });
    api.onDidCloseRepository?.((repo) => {
      if (this.repo === repo) {
        this.bind(undefined);
      }
    });
    this.log?.(
      `git: ${api.repositories.length} repository(ies) known: ${api.repositories
        .map((repo) => repo.rootUri.fsPath)
        .join(", ")}`,
    );
    const match = api.repositories.find((repo) => this.covers(repo.rootUri.fsPath));
    if (match) {
      this.bind(match);
    } else {
      this.log?.(`git: no repository matches ${this.folder.uri.fsPath}`);
      this.publish(this.fallback());
    }
  }

  /** True when the repository root contains the workspace folder. */
  private covers(rootPath: string): boolean {
    const root = normalizePath(rootPath);
    const folder = normalizePath(this.folder.uri.fsPath);
    return root === folder || folder.startsWith(root + "/");
  }

  private bind(repo: GitRepository | undefined): void {
    this.repoListener?.dispose();
    this.repoListener = undefined;
    this.repo = repo;
    if (repo) {
      if (typeof repo.onDidChange === "function") {
        this.repoListener = repo.onDidChange(() => this.publish(this.read(repo)));
      } else {
        // 部分环境下内置 git 扩展返回的仓库对象缺少 onDidChange 事件属性；
        // 降级为不监听，仅保留下方一次性状态读取。
        this.log?.("git: repository does not expose onDidChange; change listening disabled");
      }
    }
    this.publish(this.read(repo));
  }

  private read(repo: GitRepository | undefined): GitStatus {
    if (!repo) {
      return this.fallback();
    }
    const state = repo.state;
    // state 形状异常（未就绪或 API 变化）时退回 .git/HEAD 直读，而不是抛错。
    if (!state || !Array.isArray(state.indexChanges) || !Array.isArray(state.workingTreeChanges)) {
      return this.fallback();
    }
    const changes = state.indexChanges.length + state.workingTreeChanges.length;
    return { branch: state.HEAD?.name, dirty: changes > 0 };
  }

  /** Branch read straight from `.git/HEAD`; no dirty state available. */
  private fallback(): GitStatus {
    return { branch: readGitHead(this.folder.uri.fsPath), dirty: false };
  }

  private publish(status: GitStatus): void {
    if (status.branch === this.status.branch && status.dirty === this.status.dirty) {
      return;
    }
    this.status = status;
    this.emitter.fire(status);
  }
}

/** Compare paths the same way on every platform and file system. */
function normalizePath(value: string): string {
  let normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-z]:/i.test(normalized)) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/**
 * Branch name of the repository containing `folder`, read from `.git/HEAD`.
 * Returns undefined when the folder is not inside a git repository.
 */
function readGitHead(folder: string): string | undefined {
  let dir = folder;
  for (;;) {
    const head = readHead(nodePath.join(dir, ".git"));
    if (head !== undefined) {
      return head;
    }
    const parent = nodePath.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function readHead(gitDir: string): string | undefined {
  try {
    if (fs.statSync(gitDir).isDirectory()) {
      return parseHead(fs.readFileSync(nodePath.join(gitDir, "HEAD"), "utf8"));
    }
    // Worktree or submodule: ".git" is a file pointing at the real git dir.
    const pointer = fs.readFileSync(gitDir, "utf8").trim();
    const target = /^gitdir:\s*(.+)$/.exec(pointer)?.[1];
    if (!target) {
      return undefined;
    }
    const resolved = nodePath.resolve(nodePath.dirname(gitDir), target.trim());
    return parseHead(fs.readFileSync(nodePath.join(resolved, "HEAD"), "utf8"));
  } catch {
    return undefined;
  }
}

function parseHead(content: string): string | undefined {
  const value = content.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(value);
  if (ref) {
    return ref[1];
  }
  return value ? value.slice(0, 7) : undefined;
}
