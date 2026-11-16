// 真实 DOM 反馈环（diagnosing-bugs Phase 1）：静态渲染跑不到 effects，
// 而草稿隔离恰恰依赖 Composer 的 [sessionID] 切换 effect。这里用 jsdom
// 跑真实的 createRoot + effects，直接断言用户症状：A 会话的草稿/chips
// 不得出现在 B 会话，切回 A 必须原样恢复。
// 全局 DOM 设置必须是第一个 import：ESM import 会提升，react-dom
// 在模块求值时初始化，必须先于它看到 TextEvent 等 polyfill。
import { dom } from "./dom-setup";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { App } from "../webview-ui/app";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { Catalog, HostToWeb, Snapshot } from "../src/webview/protocol";
import type { ComposerHandle } from "../webview-ui/composerTypes";

const catalog: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek V4.1 Flash" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

function snapshotWith(sessionID: string): Snapshot {
  return {
    sessionID,
    title: "T",
    agent: "build",
    model: { providerID: "opencode", id: "deepseek" },
    busy: false,
    messages: [],
    pending: [],
    diffs: [],
    catalog,
    queue: [],
    queuePaused: false,
    forms: [],
    subagents: [],
    isSubagentSession: false,
  };
}

function stateAt(sessionID: string, from: ChatState = initialState): ChatState {
  const messages: HostToWeb[] = [
    { kind: "state", state: "connected", version: "1.2.3" },
    { kind: "catalog", catalog },
    { kind: "snapshot", snapshot: snapshotWith(sessionID) },
  ];
  return messages.reduce(reducer, from);
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

describe("composer isolation across session switches (real DOM)", () => {
  let root: Root;
  let container: HTMLElement;
  let handleRef: { current: ComposerHandle | undefined };

  function render(state: ChatState): void {
    act(() => {
      root.render(createElement(App, { state, send: () => {}, composerHandleRef: handleRef }));
    });
  }

  function textarea(): HTMLTextAreaElement {
    const el = document.querySelector("textarea");
    assert.ok(el, "composer textarea must be mounted");
    return el as HTMLTextAreaElement;
  }

  test("A 的草稿和附件切到 B 后消失，切回 A 原样恢复", () => {
    container = document.getElementById("root") as HTMLElement;
    handleRef = { current: undefined };
    root = createRoot(container);
    render(stateAt("ses_a"));

    // A 会话：输入草稿、加一个附件 chip（走 handle，与文件拾取路径一致）。
    act(() => {
      typeInto(textarea(), "A 的草稿");
    });
    assert.equal(textarea().value, "A 的草稿");
    act(() => {
      handleRef.current?.setChips([{ path: "a.ts", kind: "file" }]);
    });
    assert.equal(document.querySelectorAll(".token").length, 1);

    // 切到 B：草稿与附件都不得出现（用户症状的直接断言）。
    render(stateAt("ses_b"));
    assert.equal(textarea().value, "");
    assert.equal(document.querySelectorAll(".token").length, 0);

    // B 里打自己的草稿，再切回 A：恢复 A 的内容；B 的草稿留在 B。
    act(() => {
      typeInto(textarea(), "B 的草稿");
    });
    render(stateAt("ses_a"));
    assert.equal(textarea().value, "A 的草稿");
    assert.equal(document.querySelectorAll(".token").length, 1);
    render(stateAt("ses_b"));
    assert.equal(textarea().value, "B 的草稿");
    assert.equal(document.querySelectorAll(".token").length, 0);
    root.unmount();
  });
});

describe("busy composer shows a stop button (send/stop A)", () => {
  let root: Root;
  let container: HTMLElement;
  let handleRef: { current: ComposerHandle | undefined };

  function renderBusy(state: ChatState, send: (msg: unknown) => void): void {
    act(() => {
      root.render(createElement(App, { state, send, composerHandleRef: handleRef }));
    });
  }

  test("忙时：停止按钮替换发送按钮，显示排队微提示，点击发出 abort", () => {
    container = document.getElementById("root") as HTMLElement;
    handleRef = { current: undefined };
    root = createRoot(container);

    const base = stateAt("ses_a");
    const busyState: ChatState = {
      ...base,
      busy: true,
      queue: [
        { id: "q1", text: "第一条排队", attachments: [] },
        { id: "q2", text: "第二条排队", attachments: [] },
      ],
    };

    const calls: unknown[] = [];
    renderBusy(busyState, (msg) => calls.push(msg));

    // 发送按钮被停止按钮替换（同一位置，红底方块）。
    const stop = document.querySelector<HTMLButtonElement>(".send-btn.stop");
    assert.ok(stop, "busy 时应渲染 .send-btn.stop 停止按钮");
    assert.ok(document.querySelector(".queued-hint"), "排队 > 0 时应显示微提示");
    // 微提示文案（默认 en 语区）。
    assert.equal(document.querySelector(".queued-hint")?.textContent, "2 queued");

    // 点击停止 → 向宿主发出 abort。
    act(() => {
      stop?.click();
    });
    assert.ok(
      calls.some((msg) => (msg as { kind?: string }).kind === "abort"),
      "点击停止应发出 {kind:'abort'}",
    );

    // 空闲（不忙）时：恢复为发送按钮，无停止按钮、无微提示。
    renderBusy(base, (msg) => calls.push(msg));
    assert.ok(document.querySelector<HTMLButtonElement>(".send-btn:not(.stop)"));
    assert.equal(document.querySelector(".send-btn.stop"), null);
    assert.equal(document.querySelector(".queued-hint"), null);

    root.unmount();
  });
});
