import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { stripTrailingMarkers } from "../src/util/dcp-markers";

describe("trailing DCP markers", () => {
  test("a compact id on its own line goes", () => {
    assert.equal(stripTrailingMarkers("已删除 TEST.md，工作区恢复原状。\n\n@14@"), "已删除 TEST.md，工作区恢复原状。");
  });

  test("a tag glued to the last line goes too", () => {
    assert.equal(stripTrailingMarkers("工作区恢复原状。\n@14@"), "工作区恢复原状。");
    assert.equal(stripTrailingMarkers("@14@"), "");
    assert.equal(stripTrailingMarkers("完成。\n@14@\n"), "完成。");
  });

  test("several tags in a row all go", () => {
    assert.equal(stripTrailingMarkers("完成。\n@14@\n@b1@"), "完成。");
  });

  test("a priority label goes with the tag", () => {
    assert.equal(stripTrailingMarkers("完成。\n@7@ [high]"), "完成。");
  });

  test("the XML form goes", () => {
    assert.equal(stripTrailingMarkers("完成。\n<dcp-message-id>m0014</dcp-message-id>"), "完成。");
  });

  test("a tag followed by prose stays — it reads as a reference", () => {
    assert.equal(stripTrailingMarkers("@14@ 已完成"), "@14@ 已完成");
  });

  test("a tag in the middle stays", () => {
    assert.equal(stripTrailingMarkers("见 @14@ 的回复，已处理。"), "见 @14@ 的回复，已处理。");
  });

  test("something that only looks like a tag stays", () => {
    assert.equal(stripTrailingMarkers("写到的地址是 a@14@b.com"), "写到的地址是 a@14@b.com");
    assert.equal(stripTrailingMarkers("列表项 @14@"), "列表项 @14@");
    assert.equal(stripTrailingMarkers("工作区恢复原状。 @14@"), "工作区恢复原状。 @14@");
  });

  test("plain text is untouched apart from its trailing whitespace", () => {
    assert.equal(stripTrailingMarkers("没有标记。"), "没有标记。");
    assert.equal(stripTrailingMarkers("尾部空白  \n"), "尾部空白");
  });
});
