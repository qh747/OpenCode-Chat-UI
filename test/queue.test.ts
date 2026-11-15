import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import { App } from "../webview-ui/app";
import { QueueStrip } from "../webview-ui/QueueStrip";
import type { Catalog, QueuedMessage } from "../src/webview/protocol";

const item = (id: string, text: string): QueuedMessage => ({ id, text, attachments: [] });

const renderStrip = (queue: QueuedMessage[], paused: boolean): string =>
  renderToStaticMarkup(
    createElement(QueueStrip, {
      queue,
      paused,
      onForce: () => {},
      onRemove: () => {},
      onResume: () => {},
    }),
  );

describe("queue state", () => {
  test("queue updates apply only to the current session", () => {
    const base = { ...initialState, sessionID: "s1" };
    const applied = reducer(base, {
      kind: "queue",
      sessionID: "s1",
      queue: [item("a", "one")],
      paused: false,
    });
    assert.equal(applied.queue.length, 1);
    assert.equal(applied.queuePaused, false);

    const ignored = reducer(base, {
      kind: "queue",
      sessionID: "s2",
      queue: [item("b", "two")],
      paused: true,
    });
    assert.equal(ignored.queue.length, 0);
    assert.equal(ignored.queuePaused, false);
  });
});

const catalog: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek V4.1 Flash" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

describe("QueueStrip", () => {
  test("the app places the collapsed queue above the composer", () => {
    const state: ChatState = {
      ...initialState,
      connection: "connected",
      hydrated: true,
      catalogLoaded: true,
      catalog,
      queue: [item("a", "one")],
    };
    const html = renderToStaticMarkup(
      createElement(App, {
        state,
        send: () => {},
        composerHandleRef: { current: undefined },
      }),
    );
    assert.match(html, /class="queue-strip"/);
    assert.match(html, /Queue 1/);
    assert.doesNotMatch(html, /class="queue-row"/);
  });

  test("collapsed by default: header only, no message rows", () => {
    const html = renderStrip([item("a", "one"), item("b", "two")], false);
    assert.match(html, /Queue 2/);
    assert.match(html, /Sends when the turn ends/);
    assert.doesNotMatch(html, /class="queue-row"/);
  });

  test("paused queues offer a resume action", () => {
    const html = renderStrip([item("a", "one")], true);
    assert.match(html, /Paused · resumes when you continue/);
    assert.match(html, />Resume</);
  });

  test("nothing renders for an empty queue", () => {
    assert.equal(renderStrip([], false), "");
  });
});
