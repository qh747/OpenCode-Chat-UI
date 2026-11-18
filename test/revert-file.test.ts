import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { WebToHost } from "../src/webview/protocol";
import type { FileDiffInfo } from "../src/opencode/types";
import { t } from "../src/util/i18n";
import {
  createdDirectories,
  memoryFiles,
  resetFs,
  trashedPaths,
} from "./vscode-stub";

/**
 * `revertFile` writes the shared working tree back with the session's cached
 * patch. When the patch no longer matches the file (someone else edited it),
 * the old fallback wrote the raw patch text into the file — corrupting it.
 * The revert must refuse to write and say so instead (issue 02, Q3).
 */
const revertFile = (
  ChatController.prototype as unknown as {
    revertFile: (file: string) => Promise<void>;
  }
).revertFile;

const handleMessage = (
  ChatController.prototype as unknown as {
    handleMessage: (message: WebToHost) => Promise<void>;
  }
).handleMessage;

function modified(file: string, patch: string): FileDiffInfo {
  return { file, status: "modified", additions: 1, deletions: 1, patch };
}

/** The prototype methods `revertFile` delegates to; kept real so the duck-typed
 * controller exercises the actual revert path against the stubbed fs. */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

function controllerWith(diffs: FileDiffInfo[]) {
  const posted: Array<{ kind: string; message?: string }> = [];
  const controller = {
    sessionId: "ses_a",
    diffs,
    dismissed: new Map<string, string>(),
    folder: { uri: { fsPath: "/ws", path: "/ws" } },
    posted,
    post(message: { kind: string; message?: string }) {
      posted.push(message);
    },
    refreshDiffs: async () => {},
    resolveFileUri: proto.resolveFileUri,
    currentContent: proto.currentContent,
    revertedContent: proto.revertedContent,
    dismiss: proto.dismiss,
  };
  return controller;
}

describe("revertFile", () => {
  test("a modified file is written back to its before content", async () => {
    resetFs();
    memoryFiles.set("/ws/a.md", "line1\nLINE2\nline3");
    const controller = controllerWith([
      modified("a.md", "@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3"),
    ]);

    await revertFile.call(controller as unknown as ChatController, "a.md");

    assert.equal(memoryFiles.get("/ws/a.md"), "line1\nline2\nline3");
    assert.equal(trashedPaths.length, 0);
    assert.deepEqual(
      controller.posted.filter((entry) => entry.kind === "error"),
      [],
    );
  });

  test("a stale patch refuses to write and reports the conflict", async () => {
    resetFs();
    // The file moved on after the session's edit: the ±3-line search window
    // cannot anchor the hunk's after-side anywhere.
    memoryFiles.set("/ws/a.md", "line1\nCOMPLETELY-DIFFERENT\nline3");
    const controller = controllerWith([
      modified("a.md", "@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3"),
    ]);

    await revertFile.call(controller as unknown as ChatController, "a.md");

    // The file is untouched — no patch text written into it.
    assert.equal(memoryFiles.get("/ws/a.md"), "line1\nCOMPLETELY-DIFFERENT\nline3");
    assert.deepEqual(
      controller.posted.filter((entry) => entry.kind === "error"),
      [{ kind: "error", message: t("revertConflict") }],
    );
  });

  test("an added file goes to the trash", async () => {
    resetFs();
    const controller = controllerWith([
      { file: "new.md", status: "added", additions: 4, deletions: 0, patch: "" },
    ]);

    await revertFile.call(controller as unknown as ChatController, "new.md");

    assert.deepEqual(trashedPaths, ["/ws/new.md"]);
    assert.equal(memoryFiles.has("/ws/new.md"), false);
  });

  test("a deleted file is recreated with its before content", async () => {
    resetFs();
    const controller = controllerWith([
      {
        file: "gone.md",
        status: "deleted",
        additions: 0,
        deletions: 2,
        patch: "@@ -1,2 +0,0 @@\n-alpha\n-beta\n",
      },
    ]);

    await revertFile.call(controller as unknown as ChatController, "gone.md");

    assert.deepEqual(createdDirectories, ["/ws"]);
    assert.equal(memoryFiles.get("/ws/gone.md"), "alpha\nbeta");
  });

  test("a deleted file with a stale patch refuses to recreate", async () => {
    // deleted 分支走同一严格守卫（issue 02 验收）：patch 的 after 侧锚定
    // 不上磁盘内容时（此处文件已被重建为别的内容），不建目录、不写盘。
    resetFs();
    memoryFiles.set("/ws/gone.md", "someone-elses-content");
    const controller = controllerWith([
      {
        file: "gone.md",
        status: "deleted",
        additions: 0,
        deletions: 3,
        patch: "@@ -1,3 +0,0 @@\n-alpha\n shared\n-beta\n",
      },
    ]);

    await revertFile.call(controller as unknown as ChatController, "gone.md");

    assert.deepEqual(createdDirectories, []);
    assert.equal(memoryFiles.get("/ws/gone.md"), "someone-elses-content");
    assert.deepEqual(
      controller.posted.filter((entry) => entry.kind === "error"),
      [{ kind: "error", message: t("revertConflict") }],
    );
  });
});

describe("stale action guard", () => {
  /**
   * During a session switch the host flips to the incoming session while the
   * webview still renders the outgoing one. An action stamped with the session
   * the user was looking at must be dropped, or it fires into the wrong
   * conversation (issue 04b, Q9).
   */
  test("an action stamped with the session just left is dropped", async () => {
    const calls: string[] = [];
    const controller = {
      sessionId: "ses_b",
      send: async (text: string) => {
        calls.push(text);
      },
      revertFile: async (file: string) => {
        calls.push(file);
      },
    };

    await handleMessage.call(controller as unknown as ChatController, {
      kind: "send",
      text: "queued in A",
      attachments: [],
      sessionID: "ses_a",
    });
    await handleMessage.call(controller as unknown as ChatController, {
      kind: "revertFile",
      file: "a.md",
      sessionID: "ses_a",
    });

    assert.deepEqual(calls, []);
  });

  test("an unstamped or current-stamped action passes", async () => {
    const calls: string[] = [];
    const controller = {
      sessionId: "ses_b",
      send: async (text: string) => {
        calls.push(text);
      },
      revertFile: async (file: string) => {
        calls.push(file);
      },
    };

    // First message before any session exists: no stamp, no opinion.
    await handleMessage.call(controller as unknown as ChatController, {
      kind: "send",
      text: "first",
      attachments: [],
    });
    await handleMessage.call(controller as unknown as ChatController, {
      kind: "send",
      text: "current",
      attachments: [],
      sessionID: "ses_b",
    });
    await handleMessage.call(controller as unknown as ChatController, {
      kind: "revertFile",
      file: "a.md",
      sessionID: "ses_b",
    });

    assert.deepEqual(calls, ["first", "current", "a.md"]);
  });
});
