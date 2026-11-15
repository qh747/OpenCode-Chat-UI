import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  filterSkills,
  findSkillByCommand,
  groupModels,
  isFreeModel,
  mergeMentions,
  modelShortName,
  providerDisplayName,
} from "../src/util/commands";

const model = (providerID: string, modelID: string, name: string) => ({
  providerID,
  modelID,
  name,
});

describe("groupModels", () => {
  const models = [
    model("opencode", "deepseek-free", "DeepSeek V4.1 Flash Free"),
    model("opencode-go", "kimi", "Kimi K3"),
    model("opencode-go", "glm", "GLM-5.3"),
    model("anthropic", "claude", "Claude 5"),
  ];

  test("empty recent → provider sections only, opencode-go before opencode", () => {
    const sections = groupModels(models, []);
    assert.deepEqual(
      sections.map((s) => s.label),
      ["OpenCode Go", "OpenCode", "anthropic"],
    );
  });

  test("recent section first, deduped against provider sections", () => {
    const sections = groupModels(models, [
      { providerID: "opencode-go", id: "kimi" },
      { providerID: "opencode", id: "deepseek-free" },
    ]);
    assert.equal(sections[0]?.label, "Recent");
    assert.deepEqual(sections[0]?.models.map((m) => m.name), ["Kimi K3", "DeepSeek V4.1 Flash Free"]);
    // recent models are not duplicated in their provider section
    assert.equal(sections[1]?.models.filter((m) => m.name === "Kimi K3").length, 0);
  });

  test("unknown recent refs are ignored", () => {
    const sections = groupModels(models, [{ providerID: "x", id: "y" }]);
    assert.equal(sections[0]?.label, "OpenCode Go");
  });
});

describe("providerDisplayName", () => {
  test("maps known provider ids", () => {
    assert.equal(providerDisplayName("opencode-go"), "OpenCode Go");
    assert.equal(providerDisplayName("opencode"), "OpenCode");
    assert.equal(providerDisplayName("anthropic"), "anthropic");
  });
});

describe("isFreeModel", () => {
  test("detects free in name or id", () => {
    assert.equal(isFreeModel(model("opencode", "x", "DeepSeek Free")), true);
    assert.equal(isFreeModel(model("opencode", "beam-free", "Beam")), true);
    assert.equal(isFreeModel(model("opencode", "kimi", "Kimi K3")), false);
  });
});

describe("modelShortName", () => {
  test("keeps the leading two words", () => {
    assert.equal(modelShortName("DeepSeek V4.1 Flash 1017"), "DeepSeek V4.1");
    assert.equal(modelShortName("LongCat 2.5 Free"), "LongCat 2.5");
    assert.equal(modelShortName("MiniMax M3.1 Flash"), "MiniMax M3.1");
  });

  test("leaves an already-short name alone", () => {
    assert.equal(modelShortName("Kimi K3"), "Kimi K3");
    assert.equal(modelShortName("Hy4"), "Hy4");
    assert.equal(modelShortName("  spaced   out  "), "spaced out");
  });

  test("never returns an empty label", () => {
    assert.equal(modelShortName(""), "");
  });
});

describe("mergeMentions", () => {
  const files = [
    { path: "H:/w/src/main.ts", name: "main.ts" },
    { path: "H:/w/src/app.ts", name: "app.ts" },
  ];

  test("empty query lists files", () => {
    const merged = mergeMentions(files, "");
    assert.deepEqual(merged.map((m) => m.label), ["main.ts", "app.ts"]);
  });

  test("query filters files", () => {
    const merged = mergeMentions(files, "app");
    assert.deepEqual(merged.map((m) => m.label), ["app.ts"]);
    assert.deepEqual(mergeMentions(files, "zzz"), []);
  });

  test("query is case-insensitive", () => {
    assert.deepEqual(mergeMentions(files, "APP").map((m) => m.label), ["app.ts"]);
  });
});

describe("filterSkills", () => {
  const skills = [
    { id: "opencode", name: "OpenCode", description: "questions about OpenCode itself" },
    { id: "report", name: "Report", description: "report an issue" },
  ];

  test("empty query returns all skills", () => {
    assert.deepEqual(filterSkills(skills, "").map((s) => s.id), ["opencode", "report"]);
  });

  test("query matches the id or the display name", () => {
    assert.deepEqual(filterSkills(skills, "rep").map((s) => s.id), ["report"]);
    assert.deepEqual(filterSkills(skills, "Report").map((s) => s.id), ["report"]);
    assert.deepEqual(filterSkills(skills, "OpenCode").map((s) => s.id), ["opencode"]);
    assert.deepEqual(filterSkills(skills, "opencode").map((s) => s.id), ["opencode"]);
    assert.deepEqual(filterSkills(skills, "zzz"), []);
  });
});

describe("findSkillByCommand", () => {
  const skills = [
    { id: "opencode", name: "OpenCode" },
    { id: "report", name: "Report" },
  ];

  test("matches a typed command by skill id, case-insensitively", () => {
    assert.equal(findSkillByCommand(skills, "report")?.id, "report");
    assert.equal(findSkillByCommand(skills, "REPORT")?.id, "report");
    assert.equal(findSkillByCommand(skills, "/report")?.id, "report");
    assert.equal(findSkillByCommand(skills, "zzz"), undefined);
    assert.equal(findSkillByCommand(skills, ""), undefined);
  });
});
