import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { FileDiffInfo, MessageInfo } from "../src/opencode/types";
import { memoryFiles, resetFs } from "./vscode-stub";

/**
 * Disk truth for `added` rows (spec decision Q8): the range diff is computed
 * on the shared working tree, so an attributed `added` row whose file is no
 * longer on disk is a ghost — a B-side attribution overshoot, or a row
 * revived after a window reload lost the in-memory memory. `refreshDiffs`
 * drops it after the attribution filter. `deleted` rows are exempt: the file
 * missing from disk is exactly their pending state, and reverting it is the
 * pending action.
 */
const refreshDiffs = (
  ChatController.prototype as unknown as { refreshDiffs: () => Promise<void> }
).refreshDiffs;

const proto = ChatController.prototype as unknown as Record<string, unknown>;

function added(file: string): FileDiffInfo {
  return { file, status: "added", additions: 3, deletions: 0, patch: "" };
}

function deleted(file: string): FileDiffInfo {
  return {
    file,
    status: "deleted",
    additions: 0,
    deletions: 2,
    patch: "@@ -1,2 +0,0 @@\n-alpha\n-beta\n",
  };
}

/** User turn + assistant snapshot, the shape the attribution filter reads. */
function turn(files: string[]): MessageInfo[] {
  return [
    { type: "user", id: "msg_u1", time: { created: 1 }, text: "go" },
    {
      type: "assistant",
      id: "msg_a1",
      time: { created: 2 },
      content: [],
      snapshot: { files },
    },
  ];
}

/** The methods `refreshDiffs` touches, against the stubbed in-memory fs. */
function controllerWith(diffs: FileDiffInfo[], attributedFiles: string[]) {
  const posted: Array<{ sessionID?: string; diffs: FileDiffInfo[] }> = [];
  const controller = {
    sessionId: "ses_a",
    diffs,
    dismissed: new Map<string, string>(),
    diffRequest: 0,
    folder: { uri: { fsPath: "/ws", path: "/ws" } },
    posted,
    client: () => ({ sessionDiff: async () => ({ data: diffs }) }),
    turnMessages: async () => turn(attributedFiles),
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    pollStale: proto.pollStale,
    pollSessionCurrent: proto.pollSessionCurrent,
    resolveFileUri: proto.resolveFileUri,
    fileOnDisk: proto.fileOnDisk,
    broadcastDiffs(sessionID: string) {
      posted.push({ sessionID, diffs: controller.diffs });
    },
  };
  return controller;
}

function run(controller: ReturnType<typeof controllerWith>): Promise<void> {
  return refreshDiffs.call(controller as unknown as ChatController);
}

describe("added rows disk truth", () => {
  test("an added row whose file is not on disk does not show", async () => {
    resetFs();
    // The session attributed the file, but it is gone from the shared tree.
    const controller = controllerWith([added("ghost.md")], ["ghost.md"]);

    await run(controller);

    assert.deepEqual(controller.diffs, []);
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[]],
    );
  });

  test("an added row whose file is on disk still shows", async () => {
    resetFs();
    memoryFiles.set("/ws/kept.md", "created by the session");
    const controller = controllerWith([added("kept.md")], ["kept.md"]);

    await run(controller);

    assert.deepEqual(controller.diffs, [added("kept.md")]);
  });

  test("a deleted row whose file is not on disk still shows", async () => {
    // The file missing from disk is the deleted row's pending state; hiding
    // it would hide the revert that restores the file.
    resetFs();
    const controller = controllerWith([deleted("gone.md")], ["gone.md"]);

    await run(controller);

    assert.deepEqual(controller.diffs, [deleted("gone.md")]);
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[deleted("gone.md")]],
    );
  });

  test("the disk truth check runs after the attribution filter", async () => {
    // A foreign added row stays hidden by attribution even though its file
    // exists on disk; the disk check never resurrects it.
    resetFs();
    memoryFiles.set("/ws/foreign.md", "on disk");
    const controller = controllerWith([added("foreign.md")], []);

    await run(controller);

    assert.deepEqual(controller.diffs, []);
  });
});
