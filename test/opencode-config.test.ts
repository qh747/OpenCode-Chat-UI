import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  applyConfigValue,
  globalConfigDir,
  parseConfig,
  resolveConfigFile,
  updateConfigText,
  valueAtPath,
} from "../src/util/opencode-config";

describe("global config directory", () => {
  test("OPENCODE_CONFIG_DIR wins over everything else", () => {
    assert.equal(
      globalConfigDir({ OPENCODE_CONFIG_DIR: "/custom/opencode", XDG_CONFIG_HOME: "/xdg" }, "/home/u"),
      "/custom/opencode",
    );
  });

  test("XDG_CONFIG_HOME is the base, with the app name appended", () => {
    assert.equal(globalConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "/home/u"), path.join("/xdg", "opencode"));
  });

  test("otherwise it lives under the home directory", () => {
    assert.equal(globalConfigDir({}, "/home/u"), path.join("/home/u", ".config", "opencode"));
  });
});

describe("config file resolution", () => {
  test("opencode.jsonc wins over opencode.json, like the server does", () => {
    const target = resolveConfigFile("/cfg", (file) => file.endsWith(".json") || file.endsWith(".jsonc"));
    assert.equal(target.file, path.join("/cfg", "opencode.jsonc"));
    assert.equal(target.missing, false);
  });

  test("opencode.json is used when it is the only one", () => {
    const target = resolveConfigFile("/cfg", (file) => file.endsWith("opencode.json"));
    assert.equal(target.file, path.join("/cfg", "opencode.json"));
    assert.equal(target.missing, false);
  });

  test("a missing file is created as opencode.jsonc", () => {
    const target = resolveConfigFile("/cfg", () => false);
    assert.equal(target.file, path.join("/cfg", "opencode.jsonc"));
    assert.equal(target.missing, true);
  });
});

describe("reading explicit values", () => {
  const text = `{
  // the model to use
  "model": "anthropic/claude-sonnet-5-5",
  "compaction": { "auto": false, "keep": { "tokens": 12000 } },
  "instructions": ["AGENTS.md", "https://example.com/agents.md"]
}`;

  test("comments do not break parsing", () => {
    assert.equal(parseConfig(text).ok, true);
  });

  test("a nested value is found", () => {
    const parsed = parseConfig(text);
    assert.equal(valueAtPath(parsed.data, ["compaction", "keep", "tokens"]), 12000);
    assert.equal(valueAtPath(parsed.data, ["compaction", "auto"]), false);
  });

  test("an array value is found", () => {
    const parsed = parseConfig(text);
    assert.deepEqual(valueAtPath(parsed.data, ["instructions"]), [
      "AGENTS.md",
      "https://example.com/agents.md",
    ]);
  });

  test("a missing key reads as undefined", () => {
    const parsed = parseConfig(text);
    assert.equal(valueAtPath(parsed.data, ["snapshots"]), undefined);
    assert.equal(valueAtPath(parsed.data, ["compaction", "missing"]), undefined);
  });

  test("a broken file is reported instead of silently half-parsed", () => {
    const parsed = parseConfig('{ "model": }');
    assert.equal(parsed.ok, false);
    assert.ok(parsed.error && parsed.error.length > 0);
  });

  test("a file that is not an object is refused", () => {
    assert.equal(parseConfig("[1, 2]").ok, false);
  });
});

describe("writing values", () => {
  test("a comment next to an untouched key survives", () => {
    const text = `{
  // keep me
  "model": "a/b",
  "snapshots": true
}`;
    const next = updateConfigText(text, ["snapshots"], false);
    assert.match(next, /\/\/ keep me/);
    assert.match(next, /"model": "a\/b"/);
    assert.match(next, /"snapshots": false/);
  });

  test("a nested key is written without touching its siblings", () => {
    const text = `{ "compaction": { "auto": true, "keep": { "tokens": 15000 } } }`;
    const next = updateConfigText(text, ["compaction", "keep", "tokens"], 8000);
    const parsed = parseConfig(next);
    assert.equal(valueAtPath(parsed.data, ["compaction", "keep", "tokens"]), 8000);
    assert.equal(valueAtPath(parsed.data, ["compaction", "auto"]), true);
  });

  test("a missing parent object is created", () => {
    const next = updateConfigText("{}", ["tool_output", "max_lines"], 500);
    const parsed = parseConfig(next);
    assert.equal(valueAtPath(parsed.data, ["tool_output", "max_lines"]), 500);
  });

  test("undefined removes the key and leaves the rest alone", () => {
    const next = updateConfigText('{ "snapshots": true, "model": "a/b" }', ["snapshots"], undefined);
    const parsed = parseConfig(next);
    assert.equal(valueAtPath(parsed.data, ["snapshots"]), undefined);
    assert.equal(valueAtPath(parsed.data, ["model"]), "a/b");
  });

  test("a broken file is refused instead of overwritten", () => {
    assert.throws(() => updateConfigText('{ "model": }', ["snapshots"], false));
  });

  test("what was written is what a later read returns", () => {
    const next = updateConfigText("{}", ["instructions"], ["a.md", "b.md"]);
    const parsed = parseConfig(next);
    assert.deepEqual(valueAtPath(parsed.data, ["instructions"]), ["a.md", "b.md"]);
  });

  test("a string value is written as a quoted string", () => {
    const next = applyConfigValue("{}", ["model"], "anthropic/claude-sonnet-5-5");
    const parsed = parseConfig(next);
    assert.equal(valueAtPath(parsed.data, ["model"]), "anthropic/claude-sonnet-5-5");
  });
});
