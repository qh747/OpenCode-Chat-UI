import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { SERVER_SETTINGS, findSettingsItem, normalizeItemValue } from "../src/util/settings-items";
import { messages } from "../src/util/i18n";

describe("settings catalogue", () => {
  test("every item is a server config path with a localizable label", () => {
    assert.equal(SERVER_SETTINGS.length, 10);
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
