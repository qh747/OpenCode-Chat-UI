import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mentionTail } from "../src/util/mention-trigger";

describe("mention tail detection (caret based)", () => {
  test("a trailing @word at the caret opens with the query", () => {
    assert.deepEqual(mentionTail("输入@符号时", 6), { query: "符号时", atIndex: 2, caret: 6 });
    assert.deepEqual(mentionTail("foo@bar", 7), { query: "bar", atIndex: 3, caret: 7 });
  });

  test("a bare @ at the caret opens with an empty query", () => {
    assert.deepEqual(mentionTail("ab@", 3), { query: "", atIndex: 2, caret: 3 });
  });

  test("the caret elsewhere does not trigger", () => {
    // 光标在 @ 之前：光标前缀里没有尾部 @
    assert.equal(mentionTail("输入@符号时", 2), undefined);
    // 光标在 @ 词中间：查询词被光标截断，但仍然命中
    assert.deepEqual(mentionTail("foo@bar", 5), { query: "b", atIndex: 3, caret: 5 });
  });

  test("a space after the @ breaks the tail", () => {
    assert.equal(mentionTail("foo@bar baz", 11), undefined);
    assert.equal(mentionTail("@id ", 4), undefined);
  });

  test("no @ at all", () => {
    assert.equal(mentionTail("plain text", 10), undefined);
    assert.equal(mentionTail("", 0), undefined);
  });

  test("only the prefix up to the caret is considered", () => {
    // @ 在光标之后（属于后续文本），不触发
    assert.equal(mentionTail("ab@cd", 2), undefined);
  });

  test("caret is clamped into the text", () => {
    assert.deepEqual(mentionTail("a@b", 99), { query: "b", atIndex: 1, caret: 3 });
    assert.equal(mentionTail("a@b", -5), undefined);
  });
});
