import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { AttachmentRef } from "../src/webview/protocol";
import type { FileDiffInfo, MessageInfo } from "../src/opencode/types";
import { resetFs } from "./vscode-stub";

/**
 * `sendNow` starts a new turn. The rows the user reverted (dismissed with
 * their signature) must stay dismissed: the signature memory is self-sufficient
 * and only a changed signature on the same file brings a row back (spec 决策
 * Q6/Q9). Clearing the memory on every new turn used to revive reverted rows.
 */
const proto = ChatController.prototype as unknown as Record<string, unknown>;

const sendNow = (
  ChatController.prototype as unknown as {
    sendNow: (text: string, attachments: AttachmentRef[]) => Promise<void>;
  }
).sendNow;

const visibleDiffs = (
  ChatController.prototype as unknown as {
    visibleDiffs: () => FileDiffInfo[];
  }
).visibleDiffs;

const dismiss = (
  ChatController.prototype as unknown as {
    dismiss: (file: string) => void;
  }
).dismiss;

const refreshDiffs = (
  ChatController.prototype as unknown as {
    refreshDiffs: () => Promise<void>;
  }
).refreshDiffs;

function modified(file: string, additions: number): FileDiffInfo {
  return { file, status: "modified", additions, deletions: 0, patch: "" };
}

/** User turn + assistant that wrote these files（归属反转后归因过滤器认的
 *  形态：会话自己 write 过的文件；快照声明只是服务器数据，不再参与归属）。 */
function turn(files: string[]): MessageInfo[] {
  return [
    { type: "user", id: "msg_u1", time: { created: 1 }, text: "go" },
    {
      type: "assistant",
      id: "msg_a1",
      time: { created: 2 },
      content: [],
      snapshot: { files },
      tools: files.map((file) => ({
        name: "write",
        status: "completed",
        input: { path: file },
      })),
    },
  ];
}

/** A controller carrying only what `sendNow` touches. */
function sendControllerWith(diffs: FileDiffInfo[], dismissed: Map<string, string>) {
  const posted: Array<Record<string, unknown>> = [];
  const controller = {
    sessionId: "ses_a",
    diffs,
    dismissed,
    diffRequest: 0,
    busy: false,
    turnFailed: false,
    messages: [] as unknown[],
    model: undefined,
    stagedImages: new Map<string, never>(),
    folder: { uri: { fsPath: "/ws", path: "/ws" } },
    posted,
    host: { catalog: { defaultModel: undefined }, recordModelUsed() {} },
    client: () => ({ prompt: async () => ({}) }),
    activeSelection: () => undefined,
    post(message: Record<string, unknown>) {
      posted.push(message);
    },
    startPermissionPolling() {},
    startSubagentPolling() {},
    renderableTranscript() {
      return controller.messages;
    },
    visibleDiffs: proto.visibleDiffs,
  };
  return controller;
}

/** A controller carrying what `refreshDiffs` touches, against a mock server. */
function refreshControllerWith(diffs: FileDiffInfo[], serverDiffs: FileDiffInfo[], attributedFiles: string[]) {
  const posted: Array<{ sessionID?: string; diffs: FileDiffInfo[] }> = [];
  const controller = {
    sessionId: "ses_a",
    diffs,
    dismissed: new Map<string, string>(),
    diffRequest: 0,
    folder: { uri: { fsPath: "/ws", path: "/ws" } },
    posted,
    client: () => ({ sessionDiff: async () => ({ data: serverDiffs }) }),
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
    dismiss: proto.dismiss,
    visibleDiffs: proto.visibleDiffs,
  };
  return controller;
}

describe("dismissed memory across a new turn", () => {
  test("a new turn does not revive dismissed rows", async () => {
    resetFs();
    const dismissed = new Map<string, string>();
    const controller = sendControllerWith([modified("a.md", 1)], dismissed);

    // The user reverted the row, so `dismiss` remembered its signature.
    dismiss.call(controller, "a.md");
    assert.deepEqual(visibleDiffs.call(controller), []);

    await sendNow.call(controller as unknown as ChatController, "next turn", []);

    // The memory survives the new turn: the row stays hidden.
    assert.equal(dismissed.get("a.md"), "modified:1:0");
    assert.deepEqual(visibleDiffs.call(controller), []);
  });
});

describe("signature change is the only revival", () => {
  test("the agent touching the file again gives it a new signature and the row reappears", async () => {
    resetFs();
    // The session's turn is attributed to a.md; the server (mock) reports the
    // file with a changed signature after the agent edited it again.
    const controller = refreshControllerWith(
      [modified("a.md", 1)],
      [modified("a.md", 2)],
      ["a.md"],
    );

    // The user reverted the first round; the row went into hiding.
    dismiss.call(controller, "a.md");
    assert.deepEqual(visibleDiffs.call(controller), []);

    await refreshDiffs.call(controller as unknown as ChatController);

    // A different signature is a new round of changes: the row is back.
    assert.deepEqual(controller.diffs, [modified("a.md", 2)]);
    assert.deepEqual(visibleDiffs.call(controller), [modified("a.md", 2)]);
  });

  test("a refresh with the same signature keeps the dismissed row hidden", async () => {
    resetFs();
    // The server still reports the reverted round's exact signature: nothing
    // new happened, so the revert memory keeps hiding the row.
    const controller = refreshControllerWith(
      [modified("a.md", 1)],
      [modified("a.md", 1)],
      ["a.md"],
    );

    dismiss.call(controller, "a.md");
    assert.deepEqual(visibleDiffs.call(controller), []);

    await refreshDiffs.call(controller as unknown as ChatController);

    assert.deepEqual(controller.diffs, [modified("a.md", 1)]);
    assert.deepEqual(visibleDiffs.call(controller), []);
  });
});
