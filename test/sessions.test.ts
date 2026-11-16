import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  deriveSessionStatus,
  foldSubagentSessions,
  groupFoldedByDate,
  rootToExpand,
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

describe("foldSubagentSessions", () => {
  test("a session with no parent folds to a root with no children", () => {
    const folded = foldSubagentSessions([row({ id: "ses_a" })]);

    assert.equal(folded.length, 1);
    assert.equal(folded[0]?.root.id, "ses_a");
    assert.deepEqual(folded[0]?.children, []);
    assert.equal(folded[0]?.runningChildren, 0);
  });

  test("a child session folds under its root", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_root", updated: 20 }),
      row({ id: "ses_child", parentID: "ses_root", updated: 30 }),
    ]);

    assert.equal(folded.length, 1);
    assert.equal(folded[0]?.root.id, "ses_root");
    assert.deepEqual(
      folded[0]?.children.map((child) => child.id),
      ["ses_child"],
    );
  });

  test("a child whose root is missing folds as a root", () => {
    const folded = foldSubagentSessions([row({ id: "ses_child", parentID: "ses_missing" })]);

    assert.equal(folded.length, 1);
    assert.equal(folded[0]?.root.id, "ses_child");
    assert.deepEqual(folded[0]?.children, []);
  });

  test("a grandchild flattens into the nearest root", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_root", updated: 10 }),
      row({ id: "ses_child", parentID: "ses_root", created: 2, updated: 20 }),
      row({ id: "ses_grandchild", parentID: "ses_child", created: 3, updated: 30 }),
    ]);

    assert.equal(folded.length, 1);
    assert.equal(folded[0]?.root.id, "ses_root");
    assert.deepEqual(
      folded[0]?.children.map((child) => child.id),
      ["ses_child", "ses_grandchild"],
    );
  });

  test("a chain broken at an orphan root keeps its descendants attached", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_orphan", parentID: "ses_missing", updated: 20 }),
      row({ id: "ses_leaf", parentID: "ses_orphan", created: 2, updated: 30 }),
    ]);

    assert.equal(folded.length, 1);
    assert.equal(folded[0]?.root.id, "ses_orphan");
    assert.deepEqual(
      folded[0]?.children.map((child) => child.id),
      ["ses_leaf"],
    );
  });

  test("roots sort by their own updated time, newest first", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_old", updated: 10 }),
      row({ id: "ses_new", updated: 30 }),
      row({ id: "ses_mid", updated: 20 }),
    ]);

    assert.deepEqual(
      folded.map((fold) => fold.root.id),
      ["ses_new", "ses_mid", "ses_old"],
    );
  });

  test("children sort by creation time, oldest first", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_root", updated: 100 }),
      row({ id: "ses_late", parentID: "ses_root", created: 30, updated: 90 }),
      row({ id: "ses_early", parentID: "ses_root", created: 10, updated: 20 }),
    ]);

    assert.deepEqual(
      folded[0]?.children.map((child) => child.id),
      ["ses_early", "ses_late"],
    );
  });

  test("runningChildren counts only working children", () => {
    const folded = foldSubagentSessions([
      row({ id: "ses_root", updated: 10 }),
      row({ id: "ses_a", parentID: "ses_root", created: 1, updated: 1, status: "working" }),
      row({ id: "ses_b", parentID: "ses_root", created: 2, updated: 2, status: "idle" }),
      row({ id: "ses_c", parentID: "ses_root", created: 3, updated: 3, status: "failed" }),
    ]);

    assert.equal(folded[0]?.runningChildren, 1);
  });
});

describe("rootToExpand", () => {
  const folded = foldSubagentSessions([
    row({ id: "ses_root", updated: 10 }),
    row({ id: "ses_child", parentID: "ses_root", created: 2, updated: 20 }),
  ]);

  test("the root of the current session is the one to expand", () => {
    assert.equal(rootToExpand(folded, "ses_child"), "ses_root");
  });

  test("a current root or an unknown id expands nothing", () => {
    assert.equal(rootToExpand(folded, "ses_root"), undefined);
    assert.equal(rootToExpand(folded, "ses_other"), undefined);
    assert.equal(rootToExpand(folded, undefined), undefined);
  });
});

describe("groupFoldedByDate", () => {
  const day = 24 * 60 * 60 * 1000;

  test("buckets a fold by its root's time, not by a child's", () => {
    const tenDaysAgo = Date.now() - 10 * day;
    const folded = foldSubagentSessions([
      row({ id: "ses_stale", updated: tenDaysAgo }),
      row({ id: "ses_stale_child", parentID: "ses_stale", created: Date.now(), updated: Date.now() }),
      row({ id: "ses_fresh", updated: Date.now() }),
    ]);

    const groups = groupFoldedByDate(folded);

    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups[0]?.sessions.map((fold) => fold.root.id),
      ["ses_fresh"],
    );
    assert.deepEqual(
      groups[1]?.sessions.map((fold) => fold.root.id),
      ["ses_stale"],
    );
  });
});
