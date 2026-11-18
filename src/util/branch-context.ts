import type { GitInfo } from "../webview/protocol";

export interface WorkspaceStatus {
  branch?: string;
  dirty?: boolean;
}

export interface WorktreeSignal {
  directory: string;
  branch?: string;
}

export interface BranchContextInput {
  /** The panel's workspace folder — the fallback truth. */
  workspacePath: string;
  /** The git extension's workspace status (branch + dirty). */
  workspace: WorkspaceStatus;
  /** Workspace branch reported by the event stream — fresher than the
   *  extension in environments where its repository objects lack
   *  `onDidChange` and the branch would otherwise stay frozen (ADR-0013). */
  eventBranch?: string;
  /** The session's server-side directory, when it left the workspace folder. */
  sessionDirectory?: string;
  /** Branch read from the session directory (absent when unreadable). */
  sessionBranch?: string;
  /** The most recent branch signal of one of this repository's worktrees. */
  worktree?: WorktreeSignal;
}

/** Path comparison ignores separators, trailing slashes and letter case. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The branch the context strip displays (ADR-0013): the agent's working
 * context first — the session's directory, then the active worktree of this
 * repository — and the workspace folder as the fallback. The override layers
 * carry no dirty state (only the workspace knows it) and expose the directory
 * they came from; the workspace layer never sets a directory. A layer whose
 * branch is unknown falls through to the next one: the strip must show a real
 * branch or nothing at all, never a branch from the wrong place.
 */
export function resolveBranchContext(input: BranchContextInput): GitInfo {
  const session = input.sessionDirectory;
  if (session && !samePath(session, input.workspacePath) && input.sessionBranch) {
    return { branch: input.sessionBranch, directory: session };
  }
  const worktree = input.worktree;
  if (worktree && !samePath(worktree.directory, input.workspacePath) && worktree.branch) {
    return { branch: worktree.branch, directory: worktree.directory };
  }
  const branch = input.eventBranch ?? input.workspace.branch;
  const result: GitInfo = {};
  if (branch !== undefined) {
    result.branch = branch;
  }
  if (input.workspace.dirty !== undefined) {
    result.dirty = input.workspace.dirty;
  }
  return result;
}
