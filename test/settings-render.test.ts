import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel, type SettingsPanelProps } from "../webview-ui/SettingsPanel";
import { SERVER_SETTINGS } from "../src/util/settings-items";
import { setLocale, translate } from "../src/util/i18n";
import type { SettingsItemState } from "../src/webview/settings-protocol";

// The panel copy comes from the module locale; pin English for assertions.
setLocale("en");

function render(items: SettingsItemState[], overrides: Partial<SettingsPanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      items,
      scope: "global",
      models: [],
      agents: [],
      shells: [],
      send: () => {},
      ...overrides,
    }),
  );
}

function state(id: string, value: unknown, explicit: boolean, defaultText?: string): SettingsItemState {
  return { id, value, explicit, defaultText };
}

describe("settings panel", () => {
  test("every server setting is listed with its localized label", () => {
    const html = render(SERVER_SETTINGS.map((item) => state(item.id, item.defaultValue, false, item.defaultText)));
    for (const item of SERVER_SETTINGS) {
      assert.ok(html.includes(translate("en", item.labelKey)), `missing row: ${item.id}`);
    }
  });

  test("a boolean reads as a switch", () => {
    const html = render([state("compaction.auto", true, false, "true")]);
    assert.match(html, /role="switch"/);
    assert.match(html, /aria-checked="true"/);
  });

  test("a number reads as a number field", () => {
    const html = render([state("tool_output.max_lines", 2000, false, "2000")]);
    assert.match(html, /type="number"/);
    assert.match(html, /value="2000"/);
  });

  test("a list reads as one entry per line", () => {
    const html = render([state("instructions", ["AGENTS.md", "docs/rules.md"], true)]);
    assert.match(html, /<textarea/);
    assert.match(html, /AGENTS\.md\ndocs\/rules\.md/);
  });

  test("an unset value says what the server would use", () => {
    const html = render([state("tool_output.max_lines", 2000, false, "2000")]);
    assert.match(html, /not set \(server default: 2000\)/);
  });

  test("a set value does not claim to be unset", () => {
    const html = render([state("tool_output.max_lines", 500, true, "2000")]);
    assert.doesNotMatch(html, /not set \(server default/);
    assert.match(html, /reset/);
  });

  test("the scope switcher is offered", () => {
    const html = render([]);
    assert.match(html, />Global</);
    assert.match(html, />Project</);
  });

  test("the target file is shown", () => {
    const html = render([], { targetPath: "/home/u/.config/opencode/opencode.json" });
    assert.match(html, /opencode\.json/);
  });

  test("a global-only row is disabled in project scope", () => {
    const html = render([state("shell", "/bin/bash", true)], { scope: "project" });
    assert.match(html, /settings-row disabled/);
  });

  test("an external server is called out", () => {
    const html = render([], { externalServer: true });
    assert.match(html, /runs elsewhere/);
  });

  test("an error is shown", () => {
    const html = render([], { error: "Config file is not valid JSONC." });
    assert.match(html, /Config file is not valid JSONC\./);
  });
});
