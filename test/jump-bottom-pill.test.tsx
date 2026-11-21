// 「回到底部」胶囊（spec .scratch/model-markers-jump-bottom/spec.md，2026-11-22·功能2）
// 的交互测试。
// 静态渲染跑不到滚轮,这里沿用 subagent-nav 的真实 DOM 反馈环
// （jsdom + createRoot + act）,直接断言用户操作：两格滚轮出现胶囊、
// 上滚重置计数、点击回底并隐没、到底自动隐没、会话切换重置。
// jsdom 没有布局,滚动几何用 defineProperty 伪造;scrollTo 没有实现,用桩收集。
// 全局 DOM 设置必须是第一个 import（见 dom-setup.ts 说明）。
import { dom } from "./dom-setup";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { App } from "../webview-ui/app";
import { initialState, type ChatState } from "../webview-ui/state";
import type { Catalog, WebToHost } from "../src/webview/protocol";
import { user, assistant } from "./fixtures";

const CATALOG: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

// 伪造一个可滚动、不在底部的 transcript：内容 2000px,视口 500px。
const FAKE_HEIGHT = 2000;
const FAKE_VIEW = 500;
const FAKE_BOTTOM = FAKE_HEIGHT - FAKE_VIEW;

function appState(extra: Partial<ChatState> = {}): ChatState {
  return {
    ...initialState,
    hydrated: true,
    connection: "connected",
    catalogLoaded: true,
    sessionID: "ses_a",
    catalog: CATALOG,
    messages: [user("u1"), assistant("a1", undefined, "reply")],
    ...extra,
  };
}

interface Mounted {
  container: HTMLElement;
  area: HTMLElement;
  scrollToCalls: Array<{ top: number; behavior?: string }>;
  renderState: (state: ChatState) => void;
  unmount: () => void;
}

function mountApp(state: ChatState): Mounted {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  const sent: WebToHost[] = [];
  const composerHandleRef = { current: undefined };
  const renderState = (next: ChatState) => {
    act(() => {
      root.render(createElement(App, { state: next, send: (m) => sent.push(m), composerHandleRef }));
    });
  };
  renderState(state);
  const area = container.querySelector(".scroll-area") as HTMLElement;
  assert.ok(area, "the scroll area must render");
  // jsdom 没有布局:滚动的三个几何量全部按需伪造（可配置,卸载后可还原）。
  Object.defineProperty(area, "scrollHeight", { value: FAKE_HEIGHT, configurable: true });
  Object.defineProperty(area, "clientHeight", { value: FAKE_VIEW, configurable: true });
  Object.defineProperty(area, "scrollTop", { value: 0, configurable: true, writable: true });
  const scrollToCalls: Array<{ top: number; behavior?: string }> = [];
  (area as unknown as { scrollTo: unknown }).scrollTo = (options: {
    top: number;
    behavior?: string;
  }) => {
    scrollToCalls.push(options);
  };
  return {
    container,
    area,
    scrollToCalls,
    renderState,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** 真实滚轮：React 的 onWheel 从原生事件读 deltaY,普通 Event 补上该字段。 */
function wheel(area: Element, deltaY: number): void {
  act(() => {
    const event = new dom.window.Event("wheel", { bubbles: true });
    Object.defineProperty(event, "deltaY", { value: deltaY });
    area.dispatchEvent(event);
  });
}

/** 真实滚动：改 scrollTop 后派发 scroll 事件,与浏览器行为一致。 */
function scroll(area: HTMLElement, scrollTop: number): void {
  act(() => {
    area.scrollTop = scrollTop;
    area.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
  });
}

/** 真实点击：事件冒泡到 React 的根监听器,与用户点那一格完全一致。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

describe("jump-to-bottom pill (real DOM)", () => {
  test("two notches of downward wheel surface the pill; one does not", () => {
    const mounted = mountApp(appState());
    try {
      wheel(mounted.area, 120);
      assert.equal(mounted.container.querySelector(".jump-bottom"), null, "one notch is not enough");
      wheel(mounted.area, 120);
      assert.ok(mounted.container.querySelector(".jump-bottom"), "the second notch shows the pill");
    } finally {
      mounted.unmount();
    }
  });

  test("an upward wheel between notches resets the count", () => {
    const mounted = mountApp(appState());
    try {
      wheel(mounted.area, 120);
      wheel(mounted.area, -50);
      wheel(mounted.area, 120);
      assert.equal(
        mounted.container.querySelector(".jump-bottom"),
        null,
        "the upward wheel wiped the first notch",
      );
      wheel(mounted.area, 120);
      assert.ok(mounted.container.querySelector(".jump-bottom"), "two fresh notches show it");
    } finally {
      mounted.unmount();
    }
  });

  test("clicking the pill scrolls to the latest content and hides it", () => {
    const mounted = mountApp(appState());
    try {
      wheel(mounted.area, 120);
      wheel(mounted.area, 120);
      const pill = mounted.container.querySelector(".jump-bottom");
      assert.ok(pill, "pill is up before the click");
      click(pill);
      assert.equal(mounted.container.querySelector(".jump-bottom"), null, "the click hides the pill");
      // 传给 scrollTo 的是内容总高（浏览器钳制到底部）：语义就是「滚到最新」。
      assert.deepEqual(mounted.scrollToCalls, [{ top: FAKE_HEIGHT, behavior: "smooth" }]);
    } finally {
      mounted.unmount();
    }
  });

  test("reaching the bottom hides the pill again", () => {
    const mounted = mountApp(appState());
    try {
      wheel(mounted.area, 120);
      wheel(mounted.area, 120);
      assert.ok(mounted.container.querySelector(".jump-bottom"), "pill is up");
      // 挂载时钉底 effect 置了程序化滚动标志:先走一步真实滚动把它消费掉。
      scroll(mounted.area, 0);
      scroll(mounted.area, 0);
      scroll(mounted.area, FAKE_BOTTOM);
      assert.equal(
        mounted.container.querySelector(".jump-bottom"),
        null,
        "landing at the bottom hides the pill",
      );
    } finally {
      mounted.unmount();
    }
  });

  test("switching sessions resets the pill", () => {
    const mounted = mountApp(appState());
    try {
      wheel(mounted.area, 120);
      wheel(mounted.area, 120);
      assert.ok(mounted.container.querySelector(".jump-bottom"), "pill is up");
      mounted.renderState(appState({ sessionID: "ses_b" }));
      assert.equal(
        mounted.container.querySelector(".jump-bottom"),
        null,
        "a session switch never carries the pill over",
      );
    } finally {
      mounted.unmount();
    }
  });
});
