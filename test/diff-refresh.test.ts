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

/** User turn + assistant snapshot, the shape the range/filter helpers read. */
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
    client: () => client,
    turnMessages: async () => messages,
    safeCall: async (fn: () => unknown) => {
      await fn();
    },
    pollStale: proto.pollStale,
    pollSessionCurrent: proto.pollSessionCurrent,
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
    // Files another session touched inside the same workspace range are not
    // part of this session's snapshots and must not leak into the list.
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
});
