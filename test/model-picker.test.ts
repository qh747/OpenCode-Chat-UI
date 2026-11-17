import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker } from "../webview-ui/ModelPicker";
import type { ModelInfo } from "../src/opencode/types";

const MODELS: ModelInfo[] = [
  {
    providerID: "opencode-go",
    modelID: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash 1017",
    limit: { context: 200_000 },
  },
  { providerID: "opencode", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
];

describe("model picker closed label", () => {
  test("shows the model name alone — the subscription plan belongs to the menu", () => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        models: MODELS,
        recentModels: [],
        activeModel: { providerID: "opencode-go", id: "deepseek-v4.1-flash" },
        onSelect: () => {},
      }),
    );
    assert.match(html, /<span class="label-full">DeepSeek V4\.1 Flash 1017<\/span>/);
    assert.match(html, /<span class="label-short">DeepSeek V4\.1<\/span>/);
    assert.doesNotMatch(html, /OpenCode Go/);
    assert.doesNotMatch(html, /picker-provider/);
  });

  test("falls back to the model id when the catalog has not loaded", () => {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        models: [],
        recentModels: [],
        activeModel: { providerID: "opencode-go", id: "deepseek-v4.1-flash" },
        onSelect: () => {},
      }),
    );
    assert.match(html, /<span class="label-full">deepseek-v4\.1-flash<\/span>/);
  });
});
