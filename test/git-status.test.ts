// GitStatusProvider 单测：用 vscode 替身模块（见 vscode-stub.ts）驱动真实实现。
// 覆盖扩展运行时"未捕获错误 repo.onDidChange is not a function"的回归场景。
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";
import type * as vscode from "vscode";
import { GitStatusProvider } from "../src/git";

/** 测试用工作区文件夹（只需 uri.fsPath）。 */
function folderOf(dir: string): vscode.WorkspaceFolder {
  return { uri: { fsPath: dir }, name: "test", index: 0 } as unknown as vscode.WorkspaceFolder;
}

/** 与真实时序解耦：让微任务与已排队的回调全部跑完。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

const slots = globalThis as Record<string, unknown>;

test("git provider tolerates repositories without onDidChange (runtime uncaught error regression)", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "git-stub-"));
  // 复现现场：仓库对象带完整 state，但没有 onDidChange 事件属性。
  const repo = {
    rootUri: { fsPath: dir },
    state: { HEAD: { name: "main" }, indexChanges: [], workingTreeChanges: [] },
  };
  const api = { repositories: [repo] };
  slots.__vscodeGitExtensionForTest = { isActive: true, exports: { getAPI: () => api } };
  const logs: string[] = [];
  let rejection: unknown;
  const onRejection = (reason: unknown) => {
    rejection = reason;
  };
  // 提前接管 unhandledRejection：既避免默认崩溃，也让断言可确定。
  process.on("unhandledRejection", onRejection);
  try {
    const provider = new GitStatusProvider(folderOf(dir), (line) => logs.push(line));
    await settle();
    // 修复前：bind() 调用 repo.onDidChange 抛 TypeError → 未捕获 rejection。
    assert.equal(rejection, undefined);
    // 状态仍应一次性读取成功（state 形状完整）。
    assert.deepEqual(provider.current, { branch: "main", dirty: false });
    // 必须留下降级日志说明为什么不监听。
    assert.ok(logs.some((line) => line.includes("onDidChange")), logs.join("\n"));
  } finally {
    process.off("unhandledRejection", onRejection);
    slots.__vscodeGitExtensionForTest = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git provider subscribes to repository changes when onDidChange is available", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "git-stub-"));
  let listener: (() => void) | undefined;
  const state = { HEAD: { name: "main" } as { name?: string }, indexChanges: [] as unknown[], workingTreeChanges: [] as unknown[] };
  const repo = {
    rootUri: { fsPath: dir },
    state,
    onDidChange: (fn: () => void) => {
      listener = fn;
      return { dispose: () => undefined };
    },
  };
  slots.__vscodeGitExtensionForTest = { isActive: true, exports: { getAPI: () => ({ repositories: [repo] }) } };
  try {
    const provider = new GitStatusProvider(folderOf(dir), () => undefined);
    await settle();
    assert.deepEqual(provider.current, { branch: "main", dirty: false });
    // 仓库事件触发后状态随之刷新。
    state.workingTreeChanges = [{ uri: {} }];
    state.HEAD = { name: "feature" };
    listener?.();
    assert.deepEqual(provider.current, { branch: "feature", dirty: true });
  } finally {
    slots.__vscodeGitExtensionForTest = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git provider falls back to .git/HEAD when the git extension is unavailable", async () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "git-stub-"));
  slots.__vscodeGitExtensionForTest = undefined;
  const logs: string[] = [];
  try {
    const provider = new GitStatusProvider(folderOf(dir), (line) => logs.push(line));
    await settle();
    // 临时目录不在任何 git 仓库内：分支不可知、无脏状态。
    assert.deepEqual(provider.current, { branch: undefined, dirty: false });
    assert.ok(logs.some((line) => line.includes("not available")), logs.join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("git provider keeps the .git/HEAD branch when the repository state has no HEAD yet", async () => {
  // 现场：真实仓库（.git/HEAD 可读），但 git 扩展返回的仓库对象在绑定时
  // state 已就绪而 HEAD 尚未解析（undefined），且对象缺少 onDidChange 事件
  // ——没有后续事件能把分支救回来，用户看到的是永久的"无 git"。
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "git-stub-"));
  fs.mkdirSync(nodePath.join(dir, ".git"));
  fs.writeFileSync(nodePath.join(dir, ".git", "HEAD"), "ref: refs/heads/master\n");
  const repo = {
    rootUri: { fsPath: dir },
    state: { HEAD: undefined, indexChanges: [], workingTreeChanges: [] },
  };
  slots.__vscodeGitExtensionForTest = { isActive: true, exports: { getAPI: () => ({ repositories: [repo] }) } };
  const logs: string[] = [];
  try {
    const provider = new GitStatusProvider(folderOf(dir), (line) => logs.push(line));
    await settle();
    // 修复前：read() 用 state.HEAD?.name（undefined）覆盖了同步回退已读到的 master。
    assert.deepEqual(provider.current, { branch: "master", dirty: false });
    // 降级路径的日志仍应保留。
    assert.ok(logs.some((line) => line.includes("onDidChange")), logs.join("\n"));
  } finally {
    slots.__vscodeGitExtensionForTest = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
