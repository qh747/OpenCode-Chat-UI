import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import { App } from "../webview-ui/app";
import type { Catalog, HostToWeb } from "../src/webview/protocol";

const catalog: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek V4.1 Flash" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

function apply(messages: HostToWeb[]): ChatState {
  return messages.reduce(reducer, initialState);
}

function render(state: ChatState): string {
  return renderToStaticMarkup(
    createElement(App, {
      state,
      send: () => {},
      composerHandleRef: { current: undefined },
    }),
  );
}

describe("first paint", () => {
  test("the panel paints dimmed (boot layer) while the connection is still starting", () => {
    const state = apply([{ kind: "state", state: "starting", version: "1.2.3" }]);
    const html = render(state);
    assert.match(html, /class="app booting"/);
    assert.match(html, /boot-bar/);
  });

  test("the panel paints dimmed when the catalog lands before the snapshot", () => {
    const state = apply([
      { kind: "state", state: "connected", version: "1.2.3" },
      { kind: "catalog", catalog },
    ]);
    const html = render(state);
    assert.match(html, /class="app booting"/);
    // 快照未到（未水合）：加载层不该露出药丸行
    assert.doesNotMatch(html, /model-picker/);
  });

  test("the first snapshot with a full catalog undims the panel in one commit", () => {
    const state = apply([
      { kind: "state", state: "connected", version: "1.2.3" },
      { kind: "catalog", catalog },
      {
        kind: "snapshot",
        snapshot: {
          title: "Fix the thing",
          agent: "build",
          model: { providerID: "opencode", id: "deepseek" },
          busy: false,
          messages: [],
          pending: [],
          diffs: [],
          catalog,
          workspacePath: "h:\\MyCode\\opencode-plugin",
          git: { branch: "master", dirty: false },
          queue: [],
          queuePaused: false,
        },
      },
    ]);
    const html = render(state);
    // The pickers are part of the same commit, so the action bar never grows
    // after the panel is already visible.
    assert.match(html, /class="composer"/);
    assert.match(html, /model-picker/);
    assert.match(html, /class="ctx-bar"/);
    assert.doesNotMatch(html, /booting/);
  });

  test("an empty-catalog snapshot (the host's catalog race) keeps the panel dimmed", () => {
    const emptyCatalog: Catalog = { agents: [], models: [], commands: [], skills: [], recentModels: [] };
    const state = apply([
      { kind: "state", state: "connected", version: "1.2.3" },
      {
        kind: "snapshot",
        snapshot: {
          title: "Fix the thing",
          agent: "build",
          busy: false,
          messages: [],
          pending: [],
          diffs: [],
          catalog: emptyCatalog,
          workspacePath: "h:\\MyCode\\opencode-plugin",
          queue: [],
          queuePaused: false,
        },
      },
    ]);
    const html = render(state);
    assert.match(html, /class="app booting"/);
    // 目录竞态：空的模型列表不得以「模型」兜底字样上屏
    assert.doesNotMatch(html, /model-picker/);
  });

  test("a connection error is shown immediately without the boot layer", () => {
    const state = apply([{ kind: "state", state: "error", error: "spawn failed" }]);
    const html = render(state);
    assert.match(html, /spawn failed/);
    assert.doesNotMatch(html, /booting/);
    assert.doesNotMatch(html, /boot-bar/);
  });
});
