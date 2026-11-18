// 子代理导航批次（spec: .scratch/subagent-nav/spec.md）的交互测试。
// 静态渲染跑不到点击，这里沿用 composer-switch 的真实 DOM 反馈环
// （jsdom + createRoot + act），直接断言用户操作：
// 三个条的整行标题热区、子代理行跳转与同 id 守卫、返回按钮。
// 全局 DOM 设置必须是第一个 import（见 dom-setup.ts 说明）。
import { dom } from "./dom-setup";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { DiffList } from "../webview-ui/Cards";
import { QueueStrip } from "../webview-ui/QueueStrip";
import { SubagentStrip } from "../webview-ui/SubagentStrip";
import { App } from "../webview-ui/app";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { Catalog, Snapshot, WebToHost } from "../src/webview/protocol";
import type { SubagentJob } from "../src/util/subagents";
import type { FileDiffInfo } from "../src/opencode/types";

const DIFFS: FileDiffInfo[] = [
  { file: "h:\\proj\\TEST.md", status: "added", additions: 14, deletions: 0, patch: "" },
  { file: "h:\\proj\\src\\panel.ts", status: "modified", additions: 12, deletions: 3, patch: "" },
];

const JOB: SubagentJob = {
  id: "ses_child1",
  childSessionID: "ses_child1",
  agent: "General",
  description: "Run sleep 45",
  started: 1_000,
};

const QUEUE_ITEM = { id: "q1", text: "继续跑测试", attachments: [] };

const CATALOG: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek" }],
  commands: [],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

function snapshotWith(sessionID: string, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    sessionID,
    title: "T",
    agent: "build",
    model: { providerID: "opencode", id: "deepseek" },
    busy: false,
    messages: [],
    pending: [],
    diffs: [],
    catalog: CATALOG,
    queue: [],
    queuePaused: false,
    forms: [],
    subagents: [],
    isSubagentSession: false,
    ...extra,
  };
}

// --- 真实 DOM 支架 ----------------------------------------------------------

interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

function mount(element: React.ReactElement): Mounted {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
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

/** 真实点击：事件冒泡到 React 的根监听器，与用户点那一格完全一致。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

// --- 功能 1：三个条的标题行整行热区 ------------------------------------------

describe("strip heads are full-row hot zones", () => {
  test("diff head is a button spanning the row; clicking it toggles the rows", () => {
    const { container, unmount } = mount(
      createElement(DiffList, {
        diffs: DIFFS,
        maxVisibleRows: 5,
        onOpen: () => {},
        onRevert: () => {},
      }),
    );
    try {
      const head = container.querySelector(".diff-head");
      assert.ok(head, "diff head must render");
      assert.equal(head.tagName, "BUTTON", "the whole head row must be the button");
      assert.equal(container.querySelector(".diff-toggle"), null, "old inner toggle is gone");

      click(head);
      assert.ok(container.querySelector(".diff-card"), "first click expands");
      click(head);
      assert.equal(container.querySelector(".diff-card"), null, "second click collapses");
    } finally {
      unmount();
    }
  });

  test("queue head toggles from anywhere on the row, exactly once per click", () => {
    const { container, unmount } = mount(
      createElement(QueueStrip, {
        queue: [QUEUE_ITEM],
        paused: false,
        sessionID: "ses_a",
        onForce: () => {},
        onRemove: () => {},
        onResume: () => {},
      }),
    );
    try {
      const head = container.querySelector(".queue-head");
      assert.ok(head, "queue head must render");
      // 挂载即自动展开（新消息入队自动展开的既有语义），从这里开始双向切换。
      assert.ok(container.querySelector(".queue-row"), "auto-expanded on mount");

      click(head);
      assert.equal(container.querySelector(".queue-row"), null, "head click collapses");

      // 点在 toggle 按钮上：事件冒泡到整行，只能切换一次——
      // 若行与按钮各 toggle 一次，这里会回到收起态。
      const toggle = container.querySelector(".queue-toggle");
      assert.ok(toggle);
      click(toggle);
      assert.ok(container.querySelector(".queue-row"), "toggle click expands once");
    } finally {
      unmount();
    }
  });

  test("paused Resume keeps its own click and never toggles the strip", () => {
    const resumed: boolean[] = [];
    const { container, unmount } = mount(
      createElement(QueueStrip, {
        queue: [QUEUE_ITEM],
        paused: true,
        sessionID: "ses_a",
        onForce: () => {},
        onRemove: () => {},
        onResume: () => resumed.push(true),
      }),
    );
    try {
      // 挂载即自动展开；Resume 点击不得改变展开态。
      assert.ok(container.querySelector(".queue-row"), "auto-expanded on mount");
      const resume = container.querySelector(".queue-head-btn");
      assert.ok(resume, "paused strip shows the Resume button");
      click(resume);
      assert.deepEqual(resumed, [true], "Resume fires its own action");
      assert.ok(container.querySelector(".queue-row"), "Resume never toggles the strip");
    } finally {
      unmount();
    }
  });
});

// --- 功能 2：子代理行点击跳转 -------------------------------------------------

describe("subagent rows jump to the child session", () => {
  function stripProps(currentSessionId?: string) {
    return {
      jobs: [JOB],
      now: 13_000,
      initialExpanded: true,
      onStop: (id: string) => stops.push(id),
      onOpen: (id: string) => opens.push(id),
      currentSessionId,
    };
  }
  let opens: string[];
  let stops: string[];

  test("clicking the row opens the child session", () => {
    opens = [];
    stops = [];
    const { container, unmount } = mount(createElement(SubagentStrip, stripProps("ses_parent")));
    try {
      const row = container.querySelector(".subagent-open");
      assert.ok(row, "the row's main area is a button");
      click(row);
      assert.deepEqual(opens, ["ses_child1"]);
      assert.deepEqual(stops, [], "opening never stops the agent");
    } finally {
      unmount();
    }
  });

  test("clicking the subagent already on screen is a no-op", () => {
    opens = [];
    stops = [];
    const { container, unmount } = mount(createElement(SubagentStrip, stripProps("ses_child1")));
    try {
      const row = container.querySelector(".subagent-open");
      assert.ok(row);
      click(row);
      assert.deepEqual(opens, [], "same-id click must not re-switch");
    } finally {
      unmount();
    }
  });

  test("the stop button stays exclusive", () => {
    opens = [];
    stops = [];
    const { container, unmount } = mount(createElement(SubagentStrip, stripProps("ses_parent")));
    try {
      const stop = container.querySelector(".subagent-stop");
      assert.ok(stop);
      click(stop);
      assert.deepEqual(stops, ["ses_child1"]);
      assert.deepEqual(opens, [], "stopping never navigates");
    } finally {
      unmount();
    }
  });
});

// --- 功能 3：子代理视图的返回按钮 ---------------------------------------------

describe("back button in the subagent view", () => {
  function appState(extra: Partial<ChatState>): ChatState {
    return {
      ...initialState,
      hydrated: true,
      connection: "connected",
      catalogLoaded: true,
      sessionID: "ses_child",
      ...extra,
    };
  }

  function renderApp(state: ChatState) {
    const sent: WebToHost[] = [];
    const handleRef = { current: undefined };
    const mounted = mount(
      createElement(App, {
        state,
        send: (message: WebToHost) => sent.push(message),
        composerHandleRef: handleRef,
      }),
    );
    return { sent, ...mounted };
  }

  test("a subagent session swaps the logo for a back button that returns to the parent", () => {
    const { container, sent, unmount } = renderApp(
      appState({ isSubagentSession: true, parentSessionID: "ses_parent" }),
    );
    try {
      const back = container.querySelector(".header-back");
      assert.ok(back, "back button replaces the decorative logo");
      assert.equal(container.querySelector(".header-mark"), null, "logo is gone while navigating");
      click(back);
      const switches = sent.filter((message) => message.kind === "switchSession");
      assert.deepEqual(switches, [{ kind: "switchSession", id: "ses_parent" }]);
    } finally {
      unmount();
    }
  });

  test("a root session keeps the logo and shows no back button", () => {
    const { container, unmount } = renderApp(appState({ isSubagentSession: false }));
    try {
      assert.equal(container.querySelector(".header-back"), null);
      assert.ok(container.querySelector(".header-mark"));
    } finally {
      unmount();
    }
  });

  test("meta without a parent id keeps the logo (nothing to return to yet)", () => {
    const { container, unmount } = renderApp(appState({ isSubagentSession: true }));
    try {
      assert.equal(container.querySelector(".header-back"), null);
      assert.ok(container.querySelector(".header-mark"));
    } finally {
      unmount();
    }
  });
});

// --- 协议面：parentSessionID 进入 webview 状态 --------------------------------

describe("parentSessionID in the webview state", () => {
  test("sessionMeta carries the parent id", () => {
    const state = reducer(
      { ...initialState, sessionID: "ses_child" },
      { kind: "sessionMeta", sessionID: "ses_child", isSubagentSession: true, parentSessionID: "ses_parent" },
    );
    assert.equal(state.isSubagentSession, true);
    assert.equal(state.parentSessionID, "ses_parent");
  });

  test("a meta without the field clears the parent (host always ships it)", () => {
    const first = reducer(
      { ...initialState, sessionID: "ses_child" },
      { kind: "sessionMeta", sessionID: "ses_child", isSubagentSession: true, parentSessionID: "ses_parent" },
    );
    const second = reducer(first, { kind: "sessionMeta", sessionID: "ses_child", title: "renamed" });
    assert.equal(second.parentSessionID, undefined);
  });

  test("a meta for another session is ignored", () => {
    const state = reducer(
      { ...initialState, sessionID: "ses_child" },
      { kind: "sessionMeta", sessionID: "ses_other", isSubagentSession: true, parentSessionID: "ses_parent" },
    );
    assert.equal(state.parentSessionID, undefined);
  });

  test("snapshot sets the parent; one without it clears it", () => {
    const withParent = reducer(initialState, {
      kind: "snapshot",
      snapshot: snapshotWith("ses_child", { isSubagentSession: true, parentSessionID: "ses_parent" }),
    });
    assert.equal(withParent.parentSessionID, "ses_parent");

    const withoutParent = reducer(withParent, {
      kind: "snapshot",
      snapshot: snapshotWith("ses_child"),
    });
    assert.equal(withoutParent.parentSessionID, undefined);
    assert.equal(withoutParent.isSubagentSession, false);
  });
});
