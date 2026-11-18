import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { diffFileKey, diffRange, attributionSet } from "../src/util/session-diff";
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

  test("a message with no tool calls cannot attribute its snapshot files", () => {
    // Server reality (server-snapshot-attribution/01): a message's
    // snapshot.files lists whatever changed in the shared working tree
    // inside its own snapshot window — a chat-only turn (`tools: []`) whose
    // window framed another session's write claims that file without having
    // touched it. No tool calls, no credibility: its files are foreign.
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_chat",
      time: { created: 1 },
      content: [],
      snapshot: { files: ["a.md"] },
      tools: [],
    };
    assert.deepEqual([...attributionSet([message])], []);
  });

  test("a message with tool calls still attributes its files", () => {
    // Anti-over-filtering guard: the credibility check must not cost real
    // writes. A write goes through a tool, so a message with tool calls
    // keeps full snapshot attribution (zero false negatives — spec 增补 Q21).
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_write",
      time: { created: 1 },
      content: [],
      snapshot: { files: ["a.md", "src/b.ts"] },
      tools: [{ name: "write", status: "completed", input: { path: "a.md" } }],
    };
    assert.deepEqual([...attributionSet([message])], ["a.md", "src/b.ts"]);
  });

  test("normalizes separators for comparing server diff paths", () => {
    assert.equal(diffFileKey("src\\webview\\panel.ts"), "src/webview/panel.ts");
    assert.equal(diffFileKey("./test.md"), "test.md");
  });
});
