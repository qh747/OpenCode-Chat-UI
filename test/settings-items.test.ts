import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { SERVER_SETTINGS, findSettingsItem, normalizeItemValue } from "../src/util/settings-items";
import { messages } from "../src/util/i18n";

describe("settings catalogue", () => {
  test("every item is a server config path with a localizable label", () => {
    assert.equal(SERVER_SETTINGS.length, 11);
    for (const item of SERVER_SETTINGS) {
      assert.ok(item.id.length > 0);
      assert.ok(item.configPath.length > 0, `${item.id} needs a config path`);
      assert.ok(messages.en[item.labelKey], `${item.id} label is missing in English`);
      assert.ok(messages["zh-cn"][item.labelKey], `${item.id} label is missing in Chinese`);
    }
  });

  test("an item is found by its id", () => {
    assert.equal(findSettingsItem("tool_output.max_lines")?.id, "tool_output.max_lines");
    assert.equal(findSettingsItem("notifications.turnComplete"), undefined);
    assert.equal(findSettingsItem("nope"), undefined);
  });

  test("only the shell is global-only", () => {
    const globalOnly = SERVER_SETTINGS.filter((item) => item.globalOnly === true);
    assert.deepEqual(globalOnly.map((item) => item.id), ["shell"]);
  });
});

// 工票02（.scratch/opencode-sidebar）：experimental.subagent_depth，
// 缺省回落 1（官方默认即禁止嵌套）。
describe("subagent depth row", () => {
  test("the depth row writes the experimental key with fallback 1", () => {
    const item = findSettingsItem("subagent_depth");
    assert.ok(item, "the row exists");
    assert.deepEqual(item.configPath, ["experimental", "subagent_depth"]);
    assert.equal(item.control, "number");
    // 官方默认 1：子代理不能再派生。显式写 1 把这个事实钉在配置文件里，
    // 面板同时显示 explicit value 与缺省回落值（GLOSSARY「Explicit value」）。
    assert.equal(item.defaultValue, 1);
    assert.equal(item.defaultText, "1");
  });
});

describe("model values", () => {
  test("a string model is left alone", () => {
    assert.equal(normalizeItemValue("model", "anthropic/claude-sonnet-5-5"), "anthropic/claude-sonnet-5-5");
  });

  test("the object form becomes the string form", () => {
    assert.equal(
      normalizeItemValue("model", { providerID: "anthropic", model: "claude-sonnet-5-5" }),
      "anthropic/claude-sonnet-5-5",
    );
  });

  test("the object form keeps its variant", () => {
    assert.equal(
      normalizeItemValue("model", { providerID: "anthropic", model: "claude-sonnet-5-5", variant: "high" }),
      "anthropic/claude-sonnet-5-5#high",
    );
  });

  test("other items are left alone", () => {
    assert.deepEqual(normalizeItemValue("instructions", ["a.md"]), ["a.md"]);
    assert.equal(normalizeItemValue("default_agent", "build"), "build");
  });
});
