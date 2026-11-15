import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { Catalog, HostToWeb } from "../src/webview/protocol";
import type { AssistantContent, AssistantMessage } from "../src/opencode/types";

const catalog: Catalog = {
  agents: [],
  models: [],
  commands: [],
  skills: [],
  recentModels: [],
};

function snapshot(content: AssistantContent[]): HostToWeb {
  return {
    kind: "snapshot",
    snapshot: {
      sessionID: "s1",
      busy: true,
      messages: [
        {
          type: "assistant",
          id: "a1",
          time: { created: 100 },
          content,
        },
      ],
      pending: [],
      diffs: [],
      catalog,
      queue: [],
      queuePaused: false,
    },
  };
}

function apply(messages: HostToWeb[]): ChatState {
  return messages.reduce(reducer, initialState);
}

function contentOf(state: ChatState): AssistantContent[] {
  const message = state.messages.find((candidate) => candidate.type === "assistant");
  assert.ok(message && message.type === "assistant");
  return (message as AssistantMessage).content;
}

describe("chat reducer streaming", () => {
  test("deltas of one ordinal build a single part", () => {
    const state = apply([
      snapshot([]),
      { kind: "textStarted", sessionID: "s1", messageID: "a1", ordinal: 0 },
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 0, delta: "he" },
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 0, delta: "llo" },
    ]);

    assert.deepEqual(contentOf(state), [{ type: "text", text: "hello" }]);
  });

  test("a new ordinal after a tool call does not touch the earlier text", () => {
    const toolPart: AssistantContent = {
      type: "tool",
      id: "call-1",
      name: "read",
      state: { status: "completed", input: {}, content: [] },
    };
    const state = apply([
      snapshot([{ type: "text", text: "first" }, toolPart]),
      { kind: "textStarted", sessionID: "s1", messageID: "a1", ordinal: 1 },
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 1, delta: "second" },
    ]);

    assert.deepEqual(contentOf(state), [
      { type: "text", text: "first" },
      toolPart,
      { type: "text", text: "second" },
    ]);
  });

  test("an ordinal that counts every part finds the right text part", () => {
    const toolPart: AssistantContent = {
      type: "tool",
      id: "call-1",
      name: "read",
      state: { status: "completed", input: {}, content: [] },
    };
    const state = apply([
      snapshot([{ type: "text", text: "first" }, toolPart, { type: "text", text: "par" }]),
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 2, delta: "tial" },
    ]);

    assert.deepEqual(contentOf(state), [
      { type: "text", text: "first" },
      toolPart,
      { type: "text", text: "partial" },
    ]);
  });

  test("textEnded replaces accumulated deltas with the authoritative text", () => {
    const state = apply([
      snapshot([]),
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 0, delta: "ab" },
      { kind: "textEnded", sessionID: "s1", messageID: "a1", ordinal: 0, text: "abc" },
    ]);

    assert.deepEqual(contentOf(state), [{ type: "text", text: "abc" }]);
  });

  test("messageContent is authoritative over local streaming state", () => {
    const state = apply([
      snapshot([{ type: "text", text: "partial" }]),
      { kind: "textDelta", sessionID: "s1", messageID: "a1", ordinal: 0, delta: "-local" },
      {
        kind: "messageContent",
        sessionID: "s1",
        messageID: "a1",
        content: [
          { type: "text", text: "final" },
          { type: "reasoning", text: "thought" },
        ],
      },
    ]);

    assert.deepEqual(contentOf(state), [
      { type: "text", text: "final" },
      { type: "reasoning", text: "thought" },
    ]);
  });

  test("events from another session are ignored", () => {
    const state = apply([
      snapshot([]),
      { kind: "textDelta", sessionID: "s2", messageID: "a1", ordinal: 0, delta: "nope" },
    ]);

    assert.deepEqual(contentOf(state), []);
  });
});
