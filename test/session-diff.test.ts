import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { diffFileKey, diffRange, attributionSet, type DiffRange } from "../src/util/session-diff";
import type { MessageInfo } from "../src/opencode/types";

function assistant(files: string[]): MessageInfo {
  return { type: "assistant", id: `a_${files.join("_")}`, time: { created: 1 }, content: [], snapshot: { files } };
}

describe("session diff range", () => {
  test("spans from the first to the newest server user turn", () => {
    const messages: MessageInfo[] = [
      { type: "user", id: "u1", time: { created: 1 }, text: "one" },
      assistant(["a.ts"]),
      { type: "user", id: "u2", time: { created: 2 }, text: "two" },
      assistant([]),
    ];
    assert.deepEqual(diffRange(messages), { from: "u1", to: "u2" });
  });

  test("local optimistic bubbles are not server turn ids", () => {
    const messages: MessageInfo[] = [
      { type: "user", id: "u1", time: { created: 1 }, text: "one" },
      { type: "user", id: "local-123", time: { created: 2 }, text: "pending" },
    ];
    assert.deepEqual(diffRange(messages), { from: "u1", to: "u1" });
  });

  test("no server turns means no range parameters", () => {
    assert.deepEqual(diffRange([]), {});
  });
});

describe("session diff file attribution", () => {
  test("unions the files named by assistant snapshots", () => {
    const files = attributionSet([
      assistant(["a.ts", "src\\b.ts"]),
      assistant(["src/b.ts", "./c.ts"]),
    ]);
    assert.deepEqual([...files].sort(), ["a.ts", "c.ts", "src/b.ts"]);
  });

  test("normalizes separators for comparing server diff paths", () => {
    assert.equal(diffFileKey("src\\webview\\panel.ts"), "src/webview/panel.ts");
    assert.equal(diffFileKey("./test.md"), "test.md");
  });
});
