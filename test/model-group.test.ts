import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { groupModels, isFreeModel, mergeMentions, providerDisplayName } from "../src/util/commands";

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

describe("mergeMentions", () => {
  const skills = [
    { name: "opencode", description: "questions about OpenCode itself" },
    { name: "report", description: "report an issue" },
  ];
  const files = [
    { path: "H:/w/src/main.ts", name: "main.ts" },
    { path: "H:/w/src/app.ts", name: "app.ts" },
  ];

  test("empty query lists skills first then files", () => {
    const merged = mergeMentions(skills, files, "");
    assert.equal(merged[0]?.kind, "skill");
    assert.equal(merged[merged.length - 1]?.kind, "file");
    assert.equal(merged.length, 4);
  });

  test("query filters both skills and files", () => {
    const merged = mergeMentions(skills, files, "app");
    assert.deepEqual(merged.map((m) => m.label), ["app.ts"]);
    const skillOnly = mergeMentions(skills, files, "report");
    assert.deepEqual(skillOnly.map((m) => m.label), ["report"]);
  });

  test("query keeps skills matching even when files do not", () => {
    const merged = mergeMentions(skills, files, "OPENCODE");
    assert.equal(merged[0]?.kind, "skill");
  });
});
