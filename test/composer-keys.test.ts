import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { shouldSend } from "../src/util/composer-keys";

describe("composer send keystroke", () => {
  test("enter mode: bare Enter sends, Shift+Enter is a newline", () => {
    assert.equal(shouldSend("enter", { shiftKey: false, ctrlKey: false, metaKey: false }), true);
    assert.equal(shouldSend("enter", { shiftKey: true, ctrlKey: false, metaKey: false }), false);
  });

  test("ctrlEnter mode: Ctrl or Cmd sends, plain and Shift+Enter are newlines", () => {
    assert.equal(shouldSend("ctrlEnter", { shiftKey: false, ctrlKey: true, metaKey: false }), true);
    assert.equal(shouldSend("ctrlEnter", { shiftKey: false, ctrlKey: false, metaKey: true }), true);
    assert.equal(shouldSend("ctrlEnter", { shiftKey: false, ctrlKey: false, metaKey: false }), false);
    assert.equal(shouldSend("ctrlEnter", { shiftKey: true, ctrlKey: true, metaKey: false }), false);
  });
});
