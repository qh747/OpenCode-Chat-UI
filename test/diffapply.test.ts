import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { parsePatch, reverseApply } from "../src/util/diffapply";

const PATCH_SIMPLE = `diff --git a/sample.txt b/sample.txt
index 1111..2222 100644
--- a/sample.txt
+++ b/sample.txt
@@ -2,4 +2,4 @@ two
 three
-four
+FOUR
 five
 six
`;

describe("parsePatch", () => {
  test("extracts hunks", () => {
    const { hunks } = parsePatch(PATCH_SIMPLE);
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0]?.oldStart, 2);
    assert.equal(hunks[0]?.newStart, 2);
    assert.equal(hunks[0]?.lines.length, 5);
  });
});

describe("reverseApply", () => {
  test("restores a modified line", () => {
    const after = ["one", "two", "three", "FOUR", "five", "six", "seven"].join("\n");
    const before = reverseApply(after, PATCH_SIMPLE);
    assert.equal(before, ["one", "two", "three", "four", "five", "six", "seven"].join("\n"));
  });

  test("restores a pure addition", () => {
    const patch = `@@ -3,0 +4,2 @@
+alpha
+beta
`;
    const after = ["one", "two", "three", "alpha", "beta", "four"].join("\n");
    assert.equal(reverseApply(after, patch), ["one", "two", "three", "four"].join("\n"));
  });

  test("restores a pure deletion", () => {
    const patch = `@@ -5,3 +4,0 @@
-gone1
-gone2
-gone3
`;
    const after = ["1", "2", "3", "4", "8", "9"].join("\n");
    assert.equal(reverseApply(after, patch), ["1", "2", "3", "4", "gone1", "gone2", "gone3", "8", "9"].join("\n"));
  });

  test("reconstructs a fully added file as empty", () => {
    const patch = `@@ -0,0 +1,3 @@
+new1
+new2
+new3
`;
    assert.equal(reverseApply("new1\nnew2\nnew3", patch), "");
  });

  test("reconstructs a fully deleted file", () => {
    const patch = `@@ -1,3 +0,0 @@
-old1
-old2
-old3
`;
    assert.equal(reverseApply("", patch), "old1\nold2\nold3");
  });

  test("applies multiple hunks bottom-up", () => {
    const patch = `@@ -1,3 +1,3 @@
-one
+ONE
 two
 three
@@ -9,3 +9,3 @@
 nine
-TEN
+ten
 eleven
`;
    const after = ["ONE", "two", "three", "4", "5", "6", "7", "8", "nine", "ten", "eleven"].join("\n");
    const before = reverseApply(after, patch);
    assert.equal(before, ["one", "two", "three", "4", "5", "6", "7", "8", "nine", "TEN", "eleven"].join("\n"));
  });

  test("throws on stale patch", () => {
    const after = "something completely different";
    assert.throws(() => reverseApply(after, PATCH_SIMPLE));
  });
});
