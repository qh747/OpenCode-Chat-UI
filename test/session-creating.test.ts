// session-stability 工票 03：点按即反馈 + 自动标题本地化 + sink 生命周期。
// 宿主侧的消息对用例在 test/session-stability.test.ts（同 harness）。
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialState, reducer } from "../webview-ui/state";
import { App } from "../webview-ui/app";
import { HistoryMenu } from "../webview-ui/HistoryMenu";
import { displaySessionTitle } from "../src/util/sessions";
import { ChatViewProvider } from "../src/webview/view";
import { Disposable } from "./vscode-stub";
import type { ChatState, Dispatch } from "../webview-ui/state";
import type { HostToWeb } from "../src/webview/protocol";
import type { HistoryRow } from "../src/util/sessions";
import type { ChatController } from "../src/webview/panel";

const apply = (messages: HostToWeb[]): ChatState => messages.reduce(reducer, initialState);

function renderApp(state: ChatState): string {
  return renderToStaticMarkup(
    createElement(App, {
      state,
      send: () => {},
      composerHandleRef: { current: undefined },
    }),
  );
}

describe("creating feedback in the webview (spec Q10a)", () => {
  test("the reducer flips and clears the creating flag", () => {
    const shown = apply([{ kind: "creatingSession", creating: true }]);
    assert.equal(shown.creatingSession, true);

    const cleared = apply([
      { kind: "creatingSession", creating: true },
      { kind: "creatingSession", creating: false },
    ]);
    assert.equal(cleared.creatingSession, false);
  });

  test("the header shows the inline creating note, then drops it", () => {
    // t("creatingSession") 的 en 文本。
    assert.match(
      renderApp({ ...initialState, creatingSession: true }),
      /header-creating[^>]*>Creating session…</,
    );
    assert.doesNotMatch(renderApp(initialState), /header-creating/);
  });

  test("an auto-generated header title displays the localized label", () => {
    const html = renderApp({ ...initialState, title: "New session - 2026-11-22T08:36:00.123Z" });
    assert.match(html, /header-title[^>]*>New session<\/span>/);
    // 原始 ISO 串不在头部任何地方露出（含 tooltip）。
    assert.doesNotMatch(html, /2026-11-22T08:36/);
  });
});

describe("auto-generated session title (spec Q11a)", () => {
  test("the server's auto title displays as the localized new-session label", () => {
    assert.equal(
      displaySessionTitle("New session - 2026-11-22T08:36:00.123Z", "Untitled"),
      "New session",
    );
    // 毫秒缺席同样命中（窄正则允许任一 ISO 精度）。
    assert.equal(displaySessionTitle("New session - 2026-11-22T08:36:00Z", "Untitled"), "New session");
  });

  test("a user-authored title passes through untouched", () => {
    assert.equal(displaySessionTitle("修编译报错", "Untitled"), "修编译报错");
  });

  test("an empty title falls back, a near-miss is not eaten", () => {
    assert.equal(displaySessionTitle(undefined, "Untitled"), "Untitled");
    // 手起的近似名（无时间戳部分）不误伤——原样降级。
    assert.equal(displaySessionTitle("New session - 2026-11-22", "Untitled"), "New session - 2026-11-22");
  });

  test("a history row with the auto title shows the label, not the raw string", () => {
    const dispatch: Dispatch = () => {};
    const autoRow: HistoryRow = {
      id: "ses_auto",
      title: "New session - 2026-11-22T08:36:00.123Z",
      created: 1,
      updated: 2,
      status: "idle",
    };
    const html = renderToStaticMarkup(
      createElement(HistoryMenu, {
        dispatch,
        groups: [{ label: "Today", sessions: [autoRow] }],
        onOpen: () => {},
        initialOpen: true,
      }),
    );
    assert.match(html, /status-idle">New session<\/span>/);
    // 原始 ISO 串不露出。
    assert.doesNotMatch(html, /2026-11-22T08:36/);
  });
});

describe("sidebar view sink lifecycle (审计附带 3)", () => {
  test("provider dispose detaches the bridged sink", () => {
    const attached: unknown[] = [];
    const detached: unknown[] = [];
    const controller = {
      attachSink: () => {
        const sink = { focused: false };
        attached.push(sink);
        return sink;
      },
      detachSink: (sink: unknown) => {
        detached.push(sink);
      },
      handleMessage: async () => {},
    } as unknown as ChatController;

    const disposeCallbacks: Array<() => void> = [];
    const webview = {
      options: undefined,
      html: "",
      cspSource: "https://test.vscode-cdn.net",
      asWebviewUri: (uri: unknown) => uri,
      onDidReceiveMessage: () => new Disposable(() => {}),
    };
    const view = {
      webview,
      onDidDispose: (cb: () => void) => {
        disposeCallbacks.push(cb);
        return new Disposable(() => {});
      },
    };

    const provider = new ChatViewProvider(
      controller,
      { fsPath: "H:\\ext", path: "H:\\ext" } as never,
    );
    provider.resolveWebviewView(view as never);

    assert.equal(attached.length, 1);
    assert.equal(detached.length, 0);

    // 视图销毁：sink 成对拆除，不留失效广播目标。
    disposeCallbacks[0]?.();
    assert.equal(detached.length, 1);
    assert.equal(detached[0], attached[0]);
  });
});
