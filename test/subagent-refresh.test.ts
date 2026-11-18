import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { JobInfo } from "../src/opencode/types";

/**
 * Subagent polling restarts on every session switch. A late answer from the
 * session the user just left must not repopulate (or clear) the current strip.
 */
type RefreshSubagents = () => Promise<void>;

const refreshSubagents = (
  ChatController.prototype as unknown as { refreshSubagents: RefreshSubagents }
).refreshSubagents;

const proto = ChatController.prototype as unknown as Record<string, unknown>;

interface JobsClient {
  jobs: (id: string) => Promise<{ data: JobInfo[] }>;
}

interface Posted {
  kind: string;
  sessionID?: string;
}

function job(sessionID: string): JobInfo {
  return {
    kind: "subagent",
    id: "job_1",
    sessionID,
    status: "running",
    time: { started: 1 },
    childSessionID: "ses_child",
    agent: "General",
    description: "work",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function controllerWith(sessionID: string, client: JobsClient) {
  const posted: Posted[] = [];
  const controller = {
    sessionId: sessionID,
    subagents: [],
    posted,
    subagentRequest: 0,
    busy: false,
    subagentTimer: 1 as unknown as ReturnType<typeof setInterval>,
    client: () => client,
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    pollStale: proto.pollStale,
    post(message: Posted) {
      posted.push(message);
    },
    clearSubagents() {
      controller.subagents = [];
    },
  };
  return controller;
}

describe("subagent refresh scoping", () => {
  test("a jobs response that lands after a session switch is discarded", async () => {
    const pending = deferred<{ data: JobInfo[] }>();
    const controller = controllerWith("ses_a", { jobs: () => pending.promise });

    const request = refreshSubagents.call(controller as unknown as ChatController);
    controller.sessionId = "ses_b";
    pending.resolve({ data: [job("ses_a")] });
    await request;

    assert.deepEqual(controller.subagents, []);
    assert.deepEqual(controller.posted, []);
  });

  test("the current session's running jobs still populate the strip", async () => {
    const controller = controllerWith("ses_a", {
      jobs: async () => ({ data: [job("ses_a")] }),
    });

    await refreshSubagents.call(controller as unknown as ChatController);

    assert.equal(controller.subagents.length, 1);
    assert.deepEqual(controller.posted, [
      { kind: "subagents", sessionID: "ses_a", jobs: controller.subagents },
    ]);
  });
});
