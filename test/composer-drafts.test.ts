import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ComposerDraftStore } from "../webview-ui/composerDrafts";

describe("per-session composer drafts", () => {
  test("switching files the outgoing draft and restores the incoming one", () => {
    const store = new ComposerDraftStore<{ path: string }>();
    // 会话 A 打了草稿，切到 B：A 的草稿入桶，B 从空开始。
    const b = store.switch("ses_a", "ses_b", { text: "A 的草稿", chips: [{ path: "x.ts" }] });
    assert.deepEqual(b, { text: "", chips: [] });
    // 切回 A：恢复 A 的草稿；B 的（空）工作状态也照常入桶。
    const a = store.switch("ses_b", "ses_a", { text: "", chips: [] });
    assert.equal(a.text, "A 的草稿");
    assert.deepEqual(a.chips, [{ path: "x.ts" }]);
  });

  test("drafts never leak across sessions", () => {
    const store = new ComposerDraftStore<{ path: string }>();
    store.switch("ses_a", "ses_b", { text: "A", chips: [{ path: "a.ts" }] });
    // B→C：C 不该看到 A 的任何内容；出栈会话 B 的（空）工作状态照常入桶。
    const c = store.switch("ses_b", "ses_c", { text: "", chips: [] });
    assert.deepEqual(c, { text: "", chips: [] });
    assert.deepEqual(store.ids().sort(), ["ses_a", "ses_b"]);
  });

  test("a restored draft is re-bucketed on the next switch", () => {
    const store = new ComposerDraftStore<{ path: string }>();
    store.switch("ses_a", "ses_b", { text: "A1", chips: [] });
    store.switch("ses_b", "ses_a", { text: "", chips: [] });
    // A 上继续打字后切走：新文本覆盖旧桶。
    store.switch("ses_a", "ses_b", { text: "A2", chips: [{ path: "y.ts" }] });
    const again = store.switch("ses_b", "ses_a", { text: "", chips: [] });
    assert.equal(again.text, "A2");
    assert.deepEqual(again.chips, [{ path: "y.ts" }]);
  });

  test("an undefined session uses its own synthetic bucket", () => {
    const store = new ComposerDraftStore<{ path: string }>();
    // 无会话状态打的草稿在会话创建（切到 id）时跟着走，不丢。
    const first = store.switch(undefined, "ses_new", { text: "预会话草稿", chips: [] });
    assert.deepEqual(first, { text: "", chips: [] });
    // 会话被删除回到无会话状态：恢复预会话桶里的草稿（不丢）。
    const back = store.switch("ses_new", undefined, { text: "", chips: [] });
    assert.equal(back.text, "预会话草稿");
    assert.deepEqual(store.ids().sort(), ["ses_new"]);
  });
});
