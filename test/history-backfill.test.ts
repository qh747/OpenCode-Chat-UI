import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../webview-ui/MessageList";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { Catalog, HostToWeb, Snapshot } from "../src/webview/protocol";
import { prependDelta, shouldRequestEarlier, TOP_THRESHOLD } from "../webview-ui/earlier";
import { setLocale } from "../src/util/i18n";
import type { MessageInfo, ModelRef } from "../src/opencode/types";

// 静态渲染断言按 en 字典逐字比对；锁定 locale,不受其他测试文件的副作用影响。
setLocale("en");

const CLAUDE: ModelRef = { providerID: "opencode", id: "claude" };
const GPT: ModelRef = { providerID: "opencode", id: "gpt" };

const catalog: Catalog = {
  agents: [],
  models: [],
  commands: [],
  skills: [],
  recentModels: [],
};

const user = (id: string, created: number): MessageInfo => ({
  type: "user",
  id,
  time: { created },
  text: id,
});

const assistant = (id: string, model?: ModelRef, text?: string): MessageInfo => ({
  type: "assistant",
  id,
  time: { created: 1 },
  content: text ? [{ type: "text", text }] : [],
  ...(model ? { model } : {}),
});

function snapshot(overrides: Partial<Snapshot> = {}): HostToWeb {
  return {
    kind: "snapshot",
    snapshot: {
      sessionID: "s1",
      busy: false,
      messages: [user("u1", 100)],
      pending: [],
      diffs: [],
      catalog,
      queue: [],
      queuePaused: false,
      ...overrides,
    },
  };
}

function apply(messages: HostToWeb[]): ChatState {
  return messages.reduce(reducer, initialState);
}

describe("load-earlier state flags", () => {
  test("the snapshot carries the host's pagination state", () => {
    const state = apply([snapshot({ hasEarlier: true, loadingEarlier: true })]);
    assert.equal(state.hasEarlier, true);
    assert.equal(state.loadingEarlier, true);
  });

  test("a snapshot without the flags keeps a fresh panel at 'nothing earlier'", () => {
    const state = apply([snapshot()]);
    assert.equal(state.hasEarlier, false);
    assert.equal(state.loadingEarlier, false);
  });

  test("the messages event updates the flags along with the merged list", () => {
    const state = apply([
      snapshot({ hasEarlier: false }),
      {
        kind: "messages",
        sessionID: "s1",
        messages: [user("u1", 100), user("u0", 50)],
        hasEarlier: true,
        loadingEarlier: true,
      },
    ]);
    assert.equal(state.messages.length, 2);
    assert.equal(state.hasEarlier, true);
    assert.equal(state.loadingEarlier, true);
  });

  test("a messages event without flags leaves the previous pagination state alone", () => {
    const state = apply([
      snapshot({ hasEarlier: true, loadingEarlier: true }),
      { kind: "messages", sessionID: "s1", messages: [user("u1", 100)] },
    ]);
    assert.equal(state.hasEarlier, true);
    assert.equal(state.loadingEarlier, true);
  });

  test("a messages event for another session changes nothing", () => {
    const state = apply([
      snapshot({ hasEarlier: true }),
      {
        kind: "messages",
        sessionID: "s2",
        messages: [user("u9", 900)],
        hasEarlier: false,
        loadingEarlier: false,
      },
    ]);
    assert.equal(state.messages.length, 1);
    assert.equal(state.hasEarlier, true);
  });
});

describe("transcript history markers", () => {
  function render(messages: MessageInfo[], hasEarlier: boolean, loadingEarlier: boolean): string {
    return renderToStaticMarkup(
      createElement(MessageList, {
        messages,
        busy: false,
        hasEarlier,
        loadingEarlier,
        onRewind: () => {},
        onOpenUrl: () => {},
        onOpenFile: () => {},
        onCopyCode: () => {},
      }),
    );
  }

  test("backfilling shows a loading indicator at the top (acceptance 2)", () => {
    const html = render([user("u1", 100)], true, true);
    assert.match(html, /history-loading/);
  });

  test("once the beginning is loaded the start marker names the session's model (acceptance 3)", () => {
    const html = render([user("u1", 100), assistant("a1", CLAUDE)], false, false);
    assert.match(html, /history-start/);
    assert.match(html, /Model: opencode\/claude/);
  });

  test("a transcript whose assistant messages carry no model shows no start marker", () => {
    const html = render([user("u1", 100), assistant("a1")], false, false);
    assert.doesNotMatch(html, /history-start/);
  });

  test("neither marker while the top has not been reached and nothing is loading", () => {
    const html = render([user("u1", 100), assistant("a1", CLAUDE)], true, false);
    assert.doesNotMatch(html, /history-loading/);
    assert.doesNotMatch(html, /history-start/);
  });

  test("a model change inserts a switch marker above the first reply of the new model", () => {
    const html = render(
      [assistant("a1", CLAUDE, "first reply"), user("u2", 200), assistant("a2", GPT, "second reply")],
      false,
      false,
    );
    const firstReply = html.indexOf("first reply");
    const marker = html.indexOf("Switched to model: opencode/gpt");
    const secondReply = html.indexOf("second reply");
    assert.ok(firstReply >= 0 && marker > firstReply, "the marker sits below the old model's reply");
    assert.ok(marker < secondReply, "the marker sits above the new model's first reply");
  });

  test("switch markers show while older pages are still loading; the start marker does not", () => {
    const html = render([assistant("a1", CLAUDE), assistant("a2", GPT)], true, false);
    assert.match(html, /Switched to model: opencode\/gpt/);
    assert.doesNotMatch(html, /Model: opencode\/claude/);
  });
});

describe("scroll decisions for load-earlier", () => {
  test("the trigger fires while the user's last real scroll kept them near the top", () => {
    assert.equal(TOP_THRESHOLD > 0, true);
    assert.equal(
      shouldRequestEarlier({ hasEarlier: true, loadingEarlier: false, lastUserScrollTop: TOP_THRESHOLD - 1 }),
      true,
    );
  });

  test("never fires without an earlier page, while loading, or without a real scroll", () => {
    assert.equal(
      shouldRequestEarlier({ hasEarlier: false, loadingEarlier: false, lastUserScrollTop: 0 }),
      false,
    );
    assert.equal(
      shouldRequestEarlier({ hasEarlier: true, loadingEarlier: true, lastUserScrollTop: 0 }),
      false,
    );
    // 初始状态没有真实滚动：面板打开时不允许自动翻页。
    assert.equal(
      shouldRequestEarlier({ hasEarlier: true, loadingEarlier: false, lastUserScrollTop: undefined }),
      false,
    );
  });

  test("a user who scrolled away from the top stops the chain", () => {
    assert.equal(
      shouldRequestEarlier({ hasEarlier: true, loadingEarlier: false, lastUserScrollTop: TOP_THRESHOLD + 5 }),
      false,
    );
  });
});

describe("prepend anchor correction", () => {
  test("prepending older pages shifts the viewport by the added height (acceptance 4)", () => {
    const older = [user("u0", 50)];
    const loaded = [user("u4", 400), user("u1", 100)];
    assert.equal(prependDelta([...older, ...loaded], "u4", 1000, 2400), 1400);
  });

  test("a plain append at the bottom does not move the scroll", () => {
    assert.equal(prependDelta([user("u1", 100), user("u4", 400)], "u1", 1000, 2400), 0);
  });

  test("a full replacement (session switch) does not move the scroll", () => {
    assert.equal(prependDelta([user("u9", 900)], "u4", 1000, 2400), 0);
  });

  test("an empty previous list (first paint) does not move the scroll", () => {
    assert.equal(prependDelta([user("u1", 100)], undefined, 0, 2400), 0);
  });
});
