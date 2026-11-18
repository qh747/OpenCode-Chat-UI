import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { ChatController } from "../src/webview/panel";
import { SessionQueues } from "../src/webview/session-queues";
import { SessionDismissed } from "../src/webview/session-dismissed";
import type { GitInfo } from "../src/webview/protocol";
import type { QueuedMessage } from "../src/webview/protocol";

/**
 * 分支条跟随 agent 工作上下文(spec 工票 01,ADR-0014):
 * - `vcs.branch.updated` 的目录是本仓 worktree → 条翻到该 worktree 分支;
 * - 目录是工作区 → 覆盖清除、采纳事件分支(治疗 git 扩展降级环境的冻结);
 * - `refreshSessionMeta` 捕获被搬移会话的 `location.directory`;
 * - 切换会话即清空覆盖,条回到工作区真值。
 */

const proto = ChatController.prototype as unknown as Record<string, unknown>;
const handleEvent = proto.handleEvent as (event: unknown) => void;
const refreshSessionMeta = proto.refreshSessionMeta as () => Promise<void>;
const switchSession = proto.switchSession as (id: string) => Promise<void>;
const adoptGitStatus = proto.adoptGitStatus as (status: GitInfo) => void;

const WS = "/repo";

interface PostedMessage {
  kind: string;
  git?: GitInfo;
}

interface BranchController {
  folder: { uri: { fsPath: string } };
  host: { isWorkspaceWorktree: (directory: string) => boolean };
  git: GitInfo;
  sessionDirectory?: string;
  worktree?: { directory: string; branch: string };
  eventBranch?: string;
  postedGit?: GitInfo;
  posted: PostedMessage[];
  publishGit: () => void;
  effectiveGit: () => GitInfo;
  post(message: PostedMessage): void;
  [key: string]: unknown;
}

function branchController(overrides: Partial<BranchController> = {}): BranchController {
  const controller: BranchController = {
    folder: { uri: { fsPath: WS } },
    host: { isWorkspaceWorktree: () => false },
    git: { branch: "master", dirty: false },
    posted: [],
    // 真原型方法:publishGit/effectiveGit/resetBranchContext 读 stub 字段。
    publishGit: proto.publishGit as BranchController["publishGit"],
    effectiveGit: proto.effectiveGit as () => GitInfo,
    post(message: PostedMessage) {
      controller.posted.push(message);
    },
    ...overrides,
  };
  return controller;
}

/** `dir/.git` 文件指针 → gitdir → HEAD,伪造一个 worktree 布局。 */
function fakeWorktree(root: string, name: string, branch: string): string {
  const ws = nodePath.join(root, "ws");
  const wt = nodePath.join(root, name);
  const gitdir = nodePath.join(ws, ".git", "worktrees", name);
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(nodePath.join(gitdir, "HEAD"), `ref: refs/heads/${branch}\n`);
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(nodePath.join(wt, ".git"), `gitdir: ${gitdir}\n`);
  return wt;
}

function lastGit(posted: PostedMessage[]): GitInfo | undefined {
  for (const message of [...posted].reverse()) {
    if (message.kind === "git") {
      return message.git;
    }
  }
  return undefined;
}

describe("worktree branch events", () => {
  test("a worktree update flips the strip to that branch with its directory", () => {
    const controller = branchController({
      host: { isWorkspaceWorktree: (directory) => directory === "/wt/x" },
    });
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: { branch: "ticket/x" },
      location: { directory: "/wt/x" },
    });
    assert.deepEqual(lastGit(controller.posted), {
      branch: "ticket/x",
      directory: "/wt/x",
    });
  });

  test("a worktree outside this repository never reaches the strip", () => {
    const controller = branchController({
      host: { isWorkspaceWorktree: () => false },
    });
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: { branch: "other" },
      location: { directory: "/unrelated/wt" },
    });
    assert.equal(lastGit(controller.posted), undefined);
    assert.equal(controller.worktree, undefined);
  });

  test("a workspace update clears the override and adopts the event branch", () => {
    const controller = branchController({
      worktree: { directory: "/wt/x", branch: "ticket/x" },
    });
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: { branch: "feature/y" },
      location: { directory: WS },
    });
    assert.equal(controller.worktree, undefined);
    assert.equal(controller.eventBranch, "feature/y");
    // dirty 保留 git 扩展值;事件分支压过可能冻结的扩展分支。
    assert.deepEqual(lastGit(controller.posted), { branch: "feature/y", dirty: false });
  });

  test("an event without a directory is ignored", () => {
    const controller = branchController();
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: { branch: "other" },
    });
    assert.equal(lastGit(controller.posted), undefined);
  });

  test("a worktree event without a branch falls back to reading the checkout", () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "branch-evt-"));
    try {
      const wt = fakeWorktree(root, "review-fix", "ticket/fix-review");
      const controller = branchController({
        host: { isWorkspaceWorktree: (directory) => directory === wt },
      });
      handleEvent.call(controller as unknown as ChatController, {
        type: "vcs.branch.updated",
        data: {},
        location: { directory: wt },
      });
      assert.deepEqual(controller.worktree, { directory: wt, branch: "ticket/fix-review" });
      assert.deepEqual(lastGit(controller.posted), {
        branch: "ticket/fix-review",
        directory: wt,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a worktree event without a branch and an unreadable checkout is ignored", () => {
    const controller = branchController({
      host: { isWorkspaceWorktree: (directory) => directory === "/wt/empty" },
    });
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: {},
      location: { directory: "/wt/empty" },
    });
    assert.equal(controller.worktree, undefined);
    assert.equal(lastGit(controller.posted), undefined);
  });

  test("identical git state is not re-posted (dedup)", () => {
    const controller = branchController({
      host: { isWorkspaceWorktree: (directory) => directory === "/wt/x" },
    });
    const event = {
      type: "vcs.branch.updated",
      data: { branch: "ticket/x" },
      location: { directory: "/wt/x" },
    };
    handleEvent.call(controller as unknown as ChatController, event);
    const count = controller.posted.filter((m) => m.kind === "git").length;
    handleEvent.call(controller as unknown as ChatController, event);
    assert.equal(controller.posted.filter((m) => m.kind === "git").length, count);
  });

  test("the git extension catching up retires the event branch (ADR-0014 决策 2)", () => {
    const controller = branchController();
    handleEvent.call(controller as unknown as ChatController, {
      type: "vcs.branch.updated",
      data: { branch: "feature/x" },
      location: { directory: WS },
    });
    assert.equal(controller.eventBranch, "feature/x");
    // 扩展追平:同一分支到达 → 覆盖撤销。
    adoptGitStatus.call(controller as unknown as ChatController, {
      branch: "feature/x",
      dirty: false,
    });
    assert.equal(controller.eventBranch, undefined);
    // 扩展恢复活性:其后它自己的分支变化直接呈现,不再被旧事件压住。
    adoptGitStatus.call(controller as unknown as ChatController, {
      branch: "feature/y",
      dirty: false,
    });
    assert.deepEqual(lastGit(controller.posted), { branch: "feature/y", dirty: false });
  });
});

describe("moved session branch", () => {
  test("refreshSessionMeta adopts the session's directory and its branch", async () => {
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "branch-ctx-"));
    try {
      const wt = fakeWorktree(root, "review-fix", "ticket/fix-review");
      const controller = branchController({
        sessionId: "ses_a",
        title: undefined,
        agent: undefined,
        model: undefined,
        isSubagentSession: false,
        parentSessionID: undefined,
        revertMessageID: undefined,
        earlierMessages: [],
        resetLoadedHistory: () => {},
        refreshMessages: async () => {},
        busy: false,
        contextTokens: undefined,
        cacheHitRate: undefined,
        client: () => ({
          getSession: async () => ({
            data: {
              title: "T",
              time: {},
              location: { directory: wt },
            },
          }),
        }),
        safeCall: async (fn: () => unknown) => {
          await fn();
        },
      }) as BranchController;
      await refreshSessionMeta.call(controller as unknown as ChatController);
      assert.equal(controller.sessionDirectory, wt);
      assert.deepEqual(lastGit(controller.posted), {
        branch: "ticket/fix-review",
        directory: wt,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("switching sessions resets the branch context", () => {
  function switchableController() {
    /** 快照记录:webview 在每次快照时看到的 git 真值。 */
    const snapshotGit: GitInfo[] = [];
    const blocked = { resolve: () => {} };
    const resyncGate = new Promise<void>((resolve) => {
      blocked.resolve = resolve;
    });
    // 直接构造(与 session-switch.test 同模式):getter 不能经
    // branchController 的展开传入——展开会对 getter 取值,提前触发。
    const controller = {
      sessionId: "ses_a",
      folder: { uri: { fsPath: WS } },
      host: { isWorkspaceWorktree: () => false },
      git: { branch: "master", dirty: false } as GitInfo,
      sessionDirectory: "/wt/x" as string | undefined,
      worktree: { directory: "/wt/x", branch: "ticket/x" } as
        | { directory: string; branch: string }
        | undefined,
      eventBranch: undefined,
      postedGit: undefined,
      posted: [] as PostedMessage[],
      publishGit: proto.publishGit as () => void,
      effectiveGit: proto.effectiveGit as () => GitInfo,
      post(message: PostedMessage) {
        controller.posted.push(message);
      },
      sessionId_key: undefined,
      isSubagentSession: false,
      parentSessionID: undefined,
      pendingAgent: undefined,
      pendingModel: undefined,
      busy: true,
      get queue(): QueuedMessage[] {
        return controller.sessionQueues.state(controller.sessionId as string).items;
      },
      sessionQueues: new SessionQueues(),
      sessionDismissed: new SessionDismissed(),
      messages: [],
      earlierMessages: [],
      earlierCursor: undefined,
      hasEarlier: false,
      loadingEarlier: false,
      pending: [] as QueuedMessage[],
      diffs: [],
      turnCache: undefined,
      dismissed: new Map<string, string>(),
      forms: [],
      context: { workspaceState: { update: async () => {} } },
      resetStreams: () => {},
      resetLoadedHistory: () => {},
      clearForms: () => {},
      clearSubagents: () => {},
      fullResync: async () => {
        await resyncGate;
      },
      drainSwitchedQueue: proto.drainSwitchedQueue,
      drainQueue: proto.drainQueue,
      forceQueued: proto.forceQueued,
      startQueued: () => {},
      postQueue: () => {},
      stashDismissed: proto.stashDismissed,
      loadDismissed: proto.loadDismissed,
      storageKey: () => "test-key",
      postSnapshot: () => {
        // 与真实 postSnapshot 同契约:快照取生效值并登记。
        snapshotGit.push((controller.effectiveGit as () => GitInfo)());
      },
    } as unknown as BranchController & { sessionQueues: SessionQueues };
    return { controller, blocked, snapshotGit };
  }

  test("switchSession clears the overrides and falls back to the workspace", async () => {
    const { controller, blocked, snapshotGit } = switchableController();
    const switching = switchSession.call(controller as unknown as ChatController, "ses_b");
    // 早快照发出(fullResync 仍被门挡住)。
    for (let i = 0; i < 100 && snapshotGit.length === 0; i += 1) {
      await Promise.resolve();
    }
    blocked.resolve();
    await switching;
    assert.equal(controller.sessionDirectory, undefined);
    assert.equal(controller.worktree, undefined);
    // 快照(含早快照)携带的已是工作区真值,而非旧会话的 worktree 覆盖。
    assert.deepEqual(snapshotGit.at(-1), { branch: "master", dirty: false });
  });
});
