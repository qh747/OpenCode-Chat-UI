import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { LiveStream, mergeLiveContent } from "../src/util/live-segments";
import type { AssistantContent } from "../src/opencode/types";

const text = (value: string): AssistantContent => ({ type: "text", text: value });
const reasoning = (value: string): AssistantContent => ({ type: "reasoning", text: value });
const tool = (): AssistantContent => ({
  type: "tool",
  id: "call-1",
  name: "read",
  state: { status: "completed", input: { file_path: "src/a.ts" }, content: [] },
});

describe("mergeLiveContent", () => {
  test("appends a text part the server has not stored yet after the tool call", () => {
    const content = [text("first"), tool()];
    const stream = new LiveStream();
    stream.append("text", 0, "first");
    stream.append("text", 1, "second");

    assert.deepEqual(mergeLiveContent(content, stream), [text("first"), tool(), text("second")]);
  });

  test("completes the part at its own ordinal instead of overwriting the last one", () => {
    const content = [text("first"), tool(), text("sec")];
    const stream = new LiveStream();
    stream.append("text", 0, "first");
    stream.append("text", 1, "second");

    assert.deepEqual(mergeLiveContent(content, stream), [text("first"), tool(), text("second")]);
  });

  test("keeps the fetched text when it is longer (server finished writing)", () => {
    const content = [text("the whole paragraph")];
    const stream = new LiveStream();
    stream.append("text", 0, "the whole");

    assert.deepEqual(mergeLiveContent(content, stream), [text("the whole paragraph")]);
  });

  test("routes reasoning and text to their own ordinals", () => {
    const content = [reasoning("think"), text("answer"), tool()];
    const stream = new LiveStream();
    stream.append("reasoning", 0, "think harder");
    stream.append("text", 0, "answer");

    assert.deepEqual(mergeLiveContent(content, stream), [
      reasoning("think harder"),
      text("answer"),
      tool(),
    ]);
  });

  test("supports ordinals that count every part, not just the same kind", () => {
    // reasoning at index 0, text at index 1 → the text part's ordinal is 1.
    const content = [reasoning("think"), text("ans")];
    const stream = new LiveStream();
    stream.append("reasoning", 0, "think");
    stream.append("text", 1, "answer");

    assert.deepEqual(mergeLiveContent(content, stream), [reasoning("think"), text("answer")]);
  });

  test("does not append an empty segment", () => {
    const content = [text("first"), tool()];
    const stream = new LiveStream();
    stream.start("text", 1);

    assert.deepEqual(mergeLiveContent(content, stream), [text("first"), tool()]);
  });

  test("never mutates the fetched content", () => {
    const content = [text("first"), tool()];
    const stream = new LiveStream();
    stream.append("text", 0, "first, extended");
    stream.append("text", 1, "second");

    mergeLiveContent(content, stream);

    assert.deepEqual(content, [text("first"), tool()]);
    assert.equal(content.length, 2);
  });
});

describe("LiveStream", () => {
  test("start keeps the text already accumulated for that ordinal", () => {
    const stream = new LiveStream();
    stream.append("text", 0, "abc");
    stream.start("text", 0);

    assert.equal(stream.list()[0]?.text, "abc");
  });

  test("end replaces the deltas with the server's closing text", () => {
    const stream = new LiveStream();
    stream.append("text", 0, "ab");
    stream.end("text", 0, "abc");

    assert.deepEqual(mergeLiveContent([], stream), [text("abc")]);
  });
});
