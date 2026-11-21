import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ChatController } from "../src/webview/panel";
import type { FileDiffInfo, MessageInfo } from "../src/opencode/types";

/**
 * `refreshDiffs` is fired by many events and by every session switch. Its
 * response must only land in the session (and the poll) that asked for it:
 * a late answer used to overwrite `this.diffs` and broadcast itself with the
 * *current* session id, so session A's files appeared in session B.
 */
type RefreshDiffs = () => Promise<void>;

const refreshDiffs = (
  ChatController.prototype as unknown as { refreshDiffs: RefreshDiffs }
).refreshDiffs;

const proto = ChatController.prototype as unknown as Record<string, unknown>;

interface DiffClient {
  sessionDiff: (
    id: string,
    range?: { from?: string; to?: string },
  ) => Promise<{ data: FileDiffInfo[] }>;
}

interface PostedDiff {
  sessionID: string | undefined;
  diffs: FileDiffInfo[];
}

function diff(file: string): FileDiffInfo {
  return { file, status: "modified", additions: 1, deletions: 0, patch: "" };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

/** The methods `refreshDiffs` touches, duck-typed so no panel is constructed. */
function controllerWith(
  sessionID: string,
  client: DiffClient,
  messages: MessageInfo[] = [],
) {
  const posted: PostedDiff[] = [];
  const controller = {
    sessionId: sessionID,
    diffs: [] as FileDiffInfo[],
    diffRequest: 0,
    posted,
    isSubagentSession: false,
    client: () => client,
    turnMessages: async () => messages,
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    pollStale: proto.pollStale,
    pollSessionCurrent: proto.pollSessionCurrent,
    // refreshDiffs 对 added 行逐个 await；真实控制器查盘，测试默认在盘上。
    fileOnDisk: async () => true,
    broadcastDiffs(sessionID: string) {
      posted.push({ sessionID, diffs: controller.diffs });
    },
  };
  return controller;
}

function run(controller: ReturnType<typeof controllerWith>): Promise<void> {
  return refreshDiffs.call(controller as unknown as ChatController);
}

describe("diff refresh scoping", () => {
  test("a response that lands after a session switch is discarded", async () => {
    const pending = deferred<{ data: FileDiffInfo[] }>();
    const controller = controllerWith(
      "ses_a",
      { sessionDiff: () => pending.promise },
      turn(["a.ts"]),
    );

    const request = run(controller);
    // The user switched to another session while A's diff request was in flight.
    controller.sessionId = "ses_b";
    pending.resolve({ data: [diff("a.ts")] });
    await request;

    assert.deepEqual(controller.diffs, []);
    assert.deepEqual(controller.posted, []);
  });

  test("an added-row answer that wakes after a session switch is discarded", async () => {
    // 用户场景的竞态形态（diff-list-memory/04 追记）：A 生成的 5 个文件
    // 全是 added 行，refreshDiffs 在逐行磁盘校验（await fileOnDisk）处
    // 挂起；用户此时切到 B——switchSession 不递增 diffRequest，令牌仍视
    // A 的 poll 为最新——醒来后的无条件赋值把 A 的行灌进 this.diffs，
    // 随任何一次 postSnapshot 以 B 的合法身份扇出。赋值前的最后一次
    // 复查必须挡住它。
    const files = ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"];
    const addedRows: FileDiffInfo[] = files.map((file) => ({
      file,
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "",
    }));
    // 归因集必须放行这些行（会话自己 write 过它们，归属反转后的语义），
    // poll 才会走到磁盘校验的 await 窗口——这是竞态的前提。
    const messages: MessageInfo[] = [
      { type: "user", id: "msg_u1", time: { created: 1 }, text: "生成这些文件" },
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
    const wake = deferred<boolean>();
    const controller = controllerWith(
      "ses_a",
      { sessionDiff: async () => ({ data: addedRows }) },
      messages,
    );
    // 探针：fileOnDisk 首次被调时通知测试——此刻 poll 已通过前两道
    // 检查、确实挂在磁盘校验的 await 窗口内。提前切换会停在更早的
    // 检查上，测不到这个窗口。
    let markDiskCheck: () => void = () => {};
    const atDiskCheck = new Promise<void>((settle) => {
      markDiskCheck = settle;
    });
    controller.fileOnDisk = () => {
      markDiskCheck();
      return wake.promise;
    };

    const request = run(controller);
    // The user switched to session B while A's added-row disk checks hung.
    await atDiskCheck;
    controller.sessionId = "ses_b";
    wake.resolve(true);
    await request;

    assert.deepEqual(controller.diffs, [], "A's rows never land in the host state");
    assert.deepEqual(controller.posted, []);
  });

  test("files session A generated do not reach B's list when B chats with a shell probe", async () => {
    // 用户复现场景（diff-list-memory/04 追记）：A 生成 5 个文件后用户
    // 切到 B 聊天。B 的探查回合调过一次 shell——归因的旧豁免通道
    // （shell 类调用全量放行，宁可全量、不丢真实改动）让这条消息窗口内
    // 的一切外来声明全量放行，A 的 5 个文件全部穿进 B 的列表，且盘上
    // 全部存在、added 磁盘兜底无效。服务器实证（server-snapshot-
    // attribution/01）：raw diff 永远包含共享树窗口内的外来改动。
    const files = ["f1.md", "f2.md", "f3.md", "f4.md", "f5.md"];
    const foreignRows: FileDiffInfo[] = files.map((file, index) => ({
      file,
      status: index % 2 === 0 ? "modified" : "added",
      additions: 1,
      deletions: 0,
      patch: "",
    }));
    // B 的聊天回合：跑过一次 shell 探查，快照窗口恰好框住 A 的写盘
    // ——snapshot.files 被共享树窗口差写宽，声明了 A 的 5 个文件。
    const messages: MessageInfo[] = [
      { type: "user", id: "msg_u1", time: { created: 1 }, text: "看看现在的状态" },
      {
        type: "assistant",
        id: "msg_a1",
        time: { created: 2 },
        content: [],
        snapshot: { files },
        tools: [{ name: "shell", status: "completed", input: { command: "ls" } }],
      },
    ];
    const controller = controllerWith(
      "ses_b",
      { sessionDiff: async () => ({ data: foreignRows }) },
      messages,
    );

    await run(controller);

    assert.deepEqual(controller.diffs, [], "B never wrote them; its list stays empty");
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[]],
    );
  });

  test("an older in-flight poll cannot overwrite a newer result", async () => {
    const first = deferred<{ data: FileDiffInfo[] }>();
    const second = deferred<{ data: FileDiffInfo[] }>();
    const controller = controllerWith(
      "ses_a",
      { sessionDiff: () => first.promise },
      turn(["b.ts"]),
    );

    const older = run(controller);
    // `refreshDiffs` captures its client synchronously, so swapping it here
    // hands the second poll a distinct in-flight request.
    controller.client = () => ({ sessionDiff: () => second.promise });
    const newer = run(controller);
    // The newer poll answers first; the older one lands afterwards with the
    // stale (empty) snapshot the server held before it wrote the files.
    second.resolve({ data: [diff("b.ts")] });
    await newer;
    first.resolve({ data: [] });
    await older;

    assert.deepEqual(controller.diffs, [diff("b.ts")]);
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[diff("b.ts")]],
    );
  });

  test("the whole session is requested, not the newest turn alone", async () => {
    const ranges: Array<{ from?: string; to?: string } | undefined> = [];
    const messages: MessageInfo[] = [
      { type: "user", id: "msg_u1", time: { created: 1 }, text: "first" },
      {
        type: "assistant",
        id: "msg_a1",
        time: { created: 2 },
        content: [],
        snapshot: { files: ["kept.ts"] },
        tools: [{ name: "write", status: "completed", input: { path: "kept.ts" } }],
      },
      { type: "user", id: "msg_u2", time: { created: 3 }, text: "thanks" },
      {
        type: "assistant",
        id: "msg_a2",
        time: { created: 4 },
        content: [],
        snapshot: { files: [] },
      },
    ];
    const controller = controllerWith(
      "ses_a",
      {
        sessionDiff: async (_id, range) => {
          ranges.push(range);
          return { data: [diff("kept.ts"), diff("other-session.ts")] };
        },
      },
      messages,
    );

    await run(controller);

    assert.deepEqual(ranges, [{ from: "msg_u1", to: "msg_u2" }]);
    // The session wrote kept.ts itself; a file another session touched
    // inside the same workspace range is not its own and must not leak.
    // 兼任回归锚（方案改动 3-③）：会话自己 write 过的文件仍显示。
    assert.deepEqual(controller.diffs, [diff("kept.ts")]);
  });

  test("an empty attribution set shows an empty list, not foreign rows", async () => {
    // A session that never ran a turn (or only chatted) has no snapshot
    // attribution. Passing the whole range diff through used to leak the
    // shared tree's state into it: reverting a.md in session A surfaced here
    // as "deleted a.md" (ADR-0008).
    const controller = controllerWith(
      "ses_b",
      { sessionDiff: async () => ({ data: [diff("a.md")] }) },
      [],
    );

    await run(controller);

    assert.deepEqual(controller.diffs, []);
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[]],
    );
  });

  test("a foreign deleted row attributed via a tool-less message is dropped", async () => {
    // Researcher reproduction (server-snapshot-attribution/01 exp3): a.md was
    // written earlier, then deleted outside any session while B's chat-only
    // turn ran. B's assistant message claims a.md in snapshot.files with
    // `tools: []` — the window framed the external delete, the message never
    // called a tool — and the range diff answers `deleted a.md +0 -4`. The
    // strict filter alone passes it (the claim IS the attribution); only the
    // per-message credibility check drops it.
    const messages: MessageInfo[] = [
      { type: "user", id: "msg_u1", time: { created: 1 }, text: "回一首诗" },
      {
        type: "assistant",
        id: "msg_a1",
        time: { created: 2 },
        content: [],
        snapshot: { files: ["a.md"] },
        tools: [],
      },
    ];
    const controller = controllerWith(
      "ses_b",
      {
        sessionDiff: async () => ({
          data: [
            {
              file: "a.md",
              status: "deleted",
              additions: 0,
              deletions: 4,
              patch: "diff --git a/a.md b/a.md\ndeleted file mode 100644\n",
            },
          ],
        }),
      },
      messages,
    );

    await run(controller);

    assert.deepEqual(controller.diffs, []);
    assert.deepEqual(
      controller.posted.map((entry) => entry.diffs),
      [[]],
    );
  });

  // 工票01（opencode-sidebar）：子代理视图不显示改动列表——连数据也不拉。
  // 门必须在 sessionDiff 之前，且作废在途的同会话轮询。
  test("a subagent session pulls no diffs at all", async () => {
    let calls = 0;
    const controller = controllerWith(
      "ses_child",
      {
        sessionDiff: async () => {
          calls += 1;
          return { data: [diff("x.ts")] };
        },
      },
      turn(["x.ts"]),
    );
    controller.isSubagentSession = true;

    await run(controller);

    assert.equal(calls, 0, "the diff endpoint is never called");
    assert.deepEqual(controller.posted, [], "nothing is broadcast");
    assert.deepEqual(controller.diffs, [], "the memory is untouched");
  });
});
