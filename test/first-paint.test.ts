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
  test("nothing is painted while the connection is still starting", () => {
    const state = apply([{ kind: "state", state: "starting", version: "1.2.3" }]);
    assert.equal(render(state), "");
  });

  test("nothing is painted when the catalog lands before the snapshot", () => {
    const state = apply([
      { kind: "state", state: "connected", version: "1.2.3" },
      { kind: "catalog", catalog },
    ]);
    assert.equal(render(state), "");
  });

  test("the first snapshot paints the whole panel in one commit", () => {
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
  });

  test("a connection error is shown without waiting for a snapshot", () => {
    const state = apply([{ kind: "state", state: "error", error: "spawn failed" }]);
    assert.match(render(state), /spawn failed/);
  });
});
