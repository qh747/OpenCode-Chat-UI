// 子代理视图减法（spec: .scratch/opencode-sidebar/issues/01-subagent-view-thinning.md）。
// 用户在 0.4.22 上从未见过排队条/子代理条——本批是结构性保证：子代理视图里
// 有数据也不能渲染。真实 DOM 反馈环沿用 subagent-nav 的支架（jsdom +
// createRoot + act），直接断言 App 的渲染结果。
// 全局 DOM 设置必须是第一个 import（见 dom-setup.ts 说明）。
import { dom } from "./dom-setup";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { App } from "../webview-ui/app";
import { initialState } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { SubagentJob } from "../src/util/subagents";
import type { FileDiffInfo, MessageInfo } from "../src/opencode/types";

const DIFFS: FileDiffInfo[] = [
  { file: "src/panel.ts", status: "modified", additions: 2, deletions: 1, patch: "" },
];

const JOB: SubagentJob = {
  id: "ses_child1",
  childSessionID: "ses_child1",
  agent: "General",
  description: "Run sleep 45",
  started: 1_000,
  status: "running",
};

const QUEUE_ITEM = { id: "q1", text: "继续跑测试", attachments: [] };

const MESSAGE: MessageInfo = { type: "user", id: "msg_u1", time: { created: 1 }, text: "go" };

function appState(extra: Partial<ChatState>): ChatState {
  return {
    ...initialState,
    hydrated: true,
    connection: "connected",
    catalogLoaded: true,
    sessionID: "ses_main",
    messages: [MESSAGE],
    diffs: DIFFS,
    subagents: [JOB],
    queue: [QUEUE_ITEM],
    ...extra,
  };
}

function mountApp(state: ChatState) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      createElement(App, {
        state,
        send: () => {},
        composerHandleRef: { current: undefined },
      }),
    );
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("subagent view hides the three strips", () => {
  test("diff list, queue strip and subagent strip never render in a subagent view, even with data", () => {
    const { container, unmount } = mountApp(
      appState({ isSubagentSession: true, parentSessionID: "ses_parent" }),
    );
    try {
      // 有数据也必须不渲染（工票01 是结构性保证，不是修空数据）。
      // 注意：断言走布尔而不是把 jsdom 元素交给 assert.equal——
      // 失败路径的元素深检在 node 24 会挂死测试进程。
      assert.ok(container.querySelector(".diff-head") === null, "diff list hidden");
      assert.ok(container.querySelector(".queue-head") === null, "queue strip hidden");
      assert.ok(container.querySelector(".subagent-strip") === null, "subagent strip hidden");
    } finally {
      unmount();
    }
  });

  test("a root session with the same data still shows all three strips", () => {
    const { container, unmount } = mountApp(appState({ isSubagentSession: false }));
    try {
      assert.ok(container.querySelector(".diff-head"), "diff list visible");
      assert.ok(container.querySelector(".queue-head"), "queue strip visible");
      assert.ok(container.querySelector(".subagent-strip"), "subagent strip visible");
    } finally {
      unmount();
    }
  });
});
