import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { resolveBranchContext } from "../src/util/branch-context";
import type { GitInfo } from "../src/webview/protocol";

/**
 * 分支条三层取真的唯一规则表(spec「分支上下文覆盖状态」):
 * 会话目录(≠工作区)> 本仓活跃 worktree > 工作区;覆盖层不带 dirty、
 * 带 directory;来源缺分支则顺延到下一层。
 */

const WS = "/repo";

function resolve(input: Partial<Parameters<typeof resolveBranchContext>[0]>): GitInfo {
  return resolveBranchContext({
    workspacePath: WS,
    workspace: { branch: "master", dirty: true },
    ...input,
  } as Parameters<typeof resolveBranchContext>[0]);
}

describe("branch context resolution", () => {
  test("a moved session's directory wins with its own branch and no dirty", () => {
    assert.deepEqual(
      resolve({
        sessionDirectory: "/wt/review-fix",
        sessionBranch: "ticket/fix-review",
      }),
      { branch: "ticket/fix-review", directory: "/wt/review-fix" },
    );
  });

  test("a session directory without a readable branch falls through to the worktree", () => {
    assert.deepEqual(
      resolve({
        sessionDirectory: "/gone",
        sessionBranch: undefined,
        worktree: { directory: "/wt/dl-01", branch: "ticket/dl-01" },
      }),
      { branch: "ticket/dl-01", directory: "/wt/dl-01" },
    );
  });

  test("the active worktree wins when the session stays in the workspace", () => {
    assert.deepEqual(
      resolve({ worktree: { directory: "/wt/dl-01", branch: "ticket/dl-01" } }),
      { branch: "ticket/dl-01", directory: "/wt/dl-01" },
    );
  });

  test("a worktree signal without a branch falls through to the workspace", () => {
    assert.deepEqual(
      resolve({ worktree: { directory: "/wt/dl-01", branch: undefined } }),
      { branch: "master", dirty: true },
    );
  });

  test("no overrides shows the workspace status without a directory", () => {
    assert.deepEqual(resolve({}), { branch: "master", dirty: true });
  });

  test("a workspace branch event beats the (possibly frozen) git extension", () => {
    assert.deepEqual(
      resolve({ eventBranch: "feature/x" }),
      { branch: "feature/x", dirty: true },
    );
  });

  test("the event branch does not override the session or worktree layers", () => {
    assert.deepEqual(
      resolve({
        eventBranch: "feature/x",
        worktree: { directory: "/wt/dl-01", branch: "ticket/dl-01" },
      }),
      { branch: "ticket/dl-01", directory: "/wt/dl-01" },
    );
  });

  test("a session directory equal to the workspace is ignored", () => {
    assert.deepEqual(
      resolve({
        sessionDirectory: "/repo",
        sessionBranch: "master",
        eventBranch: "feature/x",
      }),
      { branch: "feature/x", dirty: true },
    );
  });

  test("a worktree directory equal to the workspace is ignored", () => {
    assert.deepEqual(
      resolve({ worktree: { directory: "/repo", branch: "feature/x" } }),
      { branch: "master", dirty: true },
    );
  });
});
