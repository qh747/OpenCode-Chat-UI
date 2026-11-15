import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { deriveSessionStatus } from "../src/util/sessions";
import type { SessionRunInfo } from "../src/util/sessions";

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
