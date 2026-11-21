import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { JobInfo } from "../src/opencode/types";
import type { SubagentJob } from "../src/util/subagents";

/**
 * Subagent polling restarts on every session switch. A late answer from the
 * session the user just left must not repopulate (or clear) the current strip.
 */
type RefreshSubagents = () => Promise<void>;

const refreshSubagents = (
  ChatController.prototype as unknown as { refreshSubagents: RefreshSubagents }
).refreshSubagents;

type StartSubagentPolling = () => void;

const startSubagentPolling = (
  ChatController.prototype as unknown as { startSubagentPolling: StartSubagentPolling }
).startSubagentPolling;

const proto = ChatController.prototype as unknown as Record<string, unknown>;

interface JobsClient {
  jobs: (id: string) => Promise<{ data: JobInfo[] }>;
  /** spec D4：有 job 时附带拉取全服务器权限，供阻塞判定。 */
  pendingPermissions: (directory?: string) => Promise<{ data: { sessionID: string }[] }>;
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
    subagents: [] as SubagentJob[],
    posted,
    subagentRequest: 0,
    busy: false,
    isSubagentSession: false,
    subagentTimer: 1 as unknown as ReturnType<typeof setInterval>,
    client: () => client,
    host: { folderPath: "/w" },
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
    const controller = controllerWith("ses_a", {
      jobs: () => pending.promise,
      pendingPermissions: async () => ({ data: [] }),
    });

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
      pendingPermissions: async () => ({ data: [] }),
    });

    await refreshSubagents.call(controller as unknown as ChatController);

    assert.equal(controller.subagents.length, 1);
    assert.deepEqual(controller.posted, [
      { kind: "subagents", sessionID: "ses_a", jobs: controller.subagents },
    ]);
  });

  test("a child session's pending permission marks its job blocked (spec D4)", async () => {
    const controller = controllerWith("ses_a", {
      jobs: async () => ({ data: [job("ses_a")] }),
      // 权限端点返回全服务器的请求；只有挂在 childSessionID 名下的才命中。
      pendingPermissions: async () => ({
        data: [{ sessionID: "ses_other" }, { sessionID: "ses_child" }],
      }),
    });

    await refreshSubagents.call(controller as unknown as ChatController);

    assert.equal(controller.subagents[0]?.status, "blocked");
  });
});

// 工票01（.scratch/opencode-sidebar）：子代理视图连 jobs 端点都不访问，
// 也不清 strip 记忆（显示面由 webview 门控，切回主会话时重取）。
describe("subagent view pulls no job data", () => {
  test("a subagent session never fetches jobs nor posts", async () => {
    let calls = 0;
    const controller = controllerWith("ses_child", {
      jobs: async () => {
        calls += 1;
        return { data: [job("ses_child")] };
      },
      pendingPermissions: async () => ({ data: [] }),
    });
    controller.isSubagentSession = true;

    await refreshSubagents.call(controller as unknown as ChatController);

    assert.equal(calls, 0, "the jobs endpoint is never called");
    assert.deepEqual(controller.posted, [], "nothing is posted");
    assert.deepEqual(controller.subagents, [], "the strip memory is untouched");
  });
});

// 工票01：子代理视图不起轮询表；根会话不受影响（对照用例钉住不过度设门）。
describe("subagent poll timer", () => {
  test("polling never starts for a subagent session", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let refreshes = 0;
    const controller = {
      subagentTimer: undefined as unknown as ReturnType<typeof setInterval>,
      isSubagentSession: true,
      refreshSubagents: async () => {
        refreshes += 1;
      },
    };

    startSubagentPolling.call(controller as unknown as ChatController);

    assert.equal(controller.subagentTimer, undefined, "no timer is created");
    assert.equal(refreshes, 0, "no immediate refresh either");
  });

  test("a root session still starts polling", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    let refreshes = 0;
    const controller = {
      subagentTimer: undefined as unknown as ReturnType<typeof setInterval>,
      isSubagentSession: false,
      refreshSubagents: async () => {
        refreshes += 1;
      },
    };

    startSubagentPolling.call(controller as unknown as ChatController);

    assert.ok(controller.subagentTimer, "the timer is created");
    assert.equal(refreshes, 1, "one immediate refresh");
  });
});
