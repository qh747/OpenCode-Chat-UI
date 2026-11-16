import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import { App } from "../webview-ui/app";
import type { Catalog, HostToWeb, Snapshot } from "../src/webview/protocol";

const catalog: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek V4.1 Flash" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

function snapshotWith(isSubagentSession?: boolean): Snapshot {
  return {
    title: "Fix the thing",
    agent: "build",
    model: { providerID: "opencode", id: "deepseek" },
    busy: false,
    messages: [],
    pending: [],
    diffs: [],
    catalog,
    queue: [],
    queuePaused: false,
    isSubagentSession,
  };
}

function render(isSubagentSession?: boolean): string {
  const messages: HostToWeb[] = [
    { kind: "state", state: "connected", version: "1.2.3" },
    { kind: "catalog", catalog },
    { kind: "snapshot", snapshot: snapshotWith(isSubagentSession) },
  ];
  const state: ChatState = messages.reduce(reducer, initialState);
  return renderToStaticMarkup(
    createElement(App, {
      state,
      send: () => {},
      composerHandleRef: { current: undefined },
    }),
  );
}

describe("composer persistence across subagent sessions", () => {
  test("on a subagent session the composer stays mounted, only hidden", () => {
    // 回归背景（issue 12）：在主会话上传的图片、草稿等 Composer 局部状态，
    // 曾因查看子代理会话时组件被卸载而丢失。契约改为"始终挂载、仅隐藏"。
    const html = render(true);
    assert.match(html, /composer-slot is-hidden/);
    assert.match(html, /<textarea/);
  });

  test("on a main session the composer stays visible", () => {
    const html = render(false);
    assert.match(html, /composer-slot(?![^"]*is-hidden)/);
    assert.match(html, /<textarea/);
  });
});
