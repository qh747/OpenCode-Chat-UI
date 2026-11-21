import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  deriveSessionStatus,
  groupHistoryRowsByDate,
  rootSessions,
} from "../src/util/sessions";
import type { HistoryRow, SessionRunInfo } from "../src/util/sessions";

const session = (overrides: Partial<SessionRunInfo> = {}): SessionRunInfo => ({
  id: "ses_a",
  time: { busy: 1, idle: 2 },
  ...overrides,
});

describe("deriveSessionStatus", () => {
  test("blocked wins over running", () => {
    assert.equal(
      deriveSessionStatus(session(), new Set(["ses_a"]), new Set(["ses_a"])),
      "blocked",
    );
  });

  test("a session in the active map is working", () => {
    assert.equal(deriveSessionStatus(session(), new Set(["ses_a"]), new Set()), "working");
  });

  test("a busy timestamp newer than the idle one is working", () => {
    assert.equal(
      deriveSessionStatus(session({ time: { busy: 3, idle: 2 } }), new Set(), new Set()),
      "working",
    );
  });

  test("running wins over the previous turn's failure", () => {
    assert.equal(
      deriveSessionStatus(
        session({ outcome: "failed", time: { busy: 3, idle: 2 } }),
        new Set(),
        new Set(),
      ),
      "working",
    );
  });

  test("a failed last turn is failed", () => {
    assert.equal(deriveSessionStatus(session({ outcome: "failed" }), new Set(), new Set()), "failed");
  });

  test("an interrupted last turn is failed", () => {
    assert.equal(
      deriveSessionStatus(session({ outcome: "interrupted" }), new Set(), new Set()),
      "failed",
    );
  });

  test("a successful last turn is idle", () => {
    assert.equal(
      deriveSessionStatus(session({ outcome: "succeeded" }), new Set(), new Set()),
      "idle",
    );
  });

  test("a session that never ran is idle", () => {
    assert.equal(deriveSessionStatus(session({ time: {} }), new Set(), new Set()), "idle");
  });
});

const row = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "ses_root",
  created: 1,
  updated: 10,
  status: "idle",
  ...overrides,
});

describe("rootSessions", () => {
  test("keeps root sessions and drops subagent sessions", () => {
    const roots = rootSessions([
      row({ id: "ses_root" }),
      row({ id: "ses_child", parentID: "ses_root" }),
    ]);
    assert.deepEqual(
      roots.map((r) => r.id),
      ["ses_root"],
    );
  });

  test("a session whose parent is outside the page is still not a root", () => {
    // 本地兜底语义（spec D1.2）：parentID 非空 = 非 root = 隐藏。
    // 服务端过滤正常时这样的行不会出现；参数被旧服务器忽略时兜底滤除。
    const roots = rootSessions([row({ id: "ses_orphan", parentID: "ses_missing" })]);
    assert.deepEqual(roots, []);
  });
});

describe("groupHistoryRowsByDate", () => {
  const day = 24 * 60 * 60 * 1000;

  test("buckets rows by their own updated time, newest first", () => {
    const tenDaysAgo = Date.now() - 10 * day;
    const groups = groupHistoryRowsByDate([
      row({ id: "ses_stale", updated: tenDaysAgo }),
      row({ id: "ses_fresh", updated: Date.now() }),
    ]);

    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups[0]?.sessions.map((r) => r.id),
      ["ses_fresh"],
    );
    assert.deepEqual(
      groups[1]?.sessions.map((r) => r.id),
      ["ses_stale"],
    );
  });
});
