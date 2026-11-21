import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { SubagentStrip, HOLD_MS } from "../webview-ui/SubagentStrip";
import { reducer, initialState } from "../webview-ui/state";
import { formatElapsed, toSubagentJobs } from "../src/util/subagents";
import type { SubagentJob } from "../src/util/subagents";
import type { JobInfo } from "../src/opencode/types";

const running: JobInfo = {
  kind: "subagent",
  id: "ses_child1",
  sessionID: "ses_parent",
  status: "running",
  title: "Run sleep 45",
  time: { started: 1_000 },
  childSessionID: "ses_child1",
  agent: "General",
  description: "Run sleep 45",
};

const failed: JobInfo = {
  ...running,
  id: "ses_child3",
  childSessionID: "ses_child3",
  status: "error",
  time: { started: 1_000, completed: 61_000 },
  agent: "Explore",
  description: "Boom",
};

const finished: JobInfo = {
  ...running,
  id: "ses_child2",
  childSessionID: "ses_child2",
  status: "completed",
  agent: "Explore",
  description: "Find the auth module",
};

const cancelled: JobInfo = {
  ...running,
  id: "ses_child4",
  childSessionID: "ses_child4",
  status: "cancelled",
};

const shell: JobInfo = {
  kind: "shell",
  id: "job_shell",
  sessionID: "ses_parent",
  status: "running",
  time: { started: 1_000 },
};

const image: JobInfo = {
  kind: "image",
  id: "job_image",
  sessionID: "ses_parent",
  status: "running",
  time: { started: 1_000 },
};

describe("toSubagentJobs", () => {
  test("keeps running subagent jobs and defaults their status to running", () => {
    const jobs = toSubagentJobs([running, finished, cancelled, shell, image]);
    assert.deepEqual(
      jobs.map((job) => job.childSessionID),
      ["ses_child1"],
    );
    assert.equal(jobs[0]?.agent, "General");
    assert.equal(jobs[0]?.description, "Run sleep 45");
    assert.equal(jobs[0]?.started, 1_000);
    assert.equal(jobs[0]?.status, "running");
  });

  test("marks a job blocked when its child session has a pending permission", () => {
    const [job] = toSubagentJobs([running], new Set(["ses_child1"]));
    assert.equal(job?.status, "blocked");
  });

  test("keeps errored jobs with the moment they ended", () => {
    const [job] = toSubagentJobs([failed]);
    assert.equal(job?.status, "error");
    assert.equal(job?.ended, 61_000);
    assert.equal(job?.description, "Boom");
  });

  test("falls back to the title when a description is missing", () => {
    const [job] = toSubagentJobs([{ ...running, description: "" }]);
    assert.equal(job?.description, "Run sleep 45");
  });
});

describe("formatElapsed", () => {
  test("seconds, minutes and hours", () => {
    assert.equal(formatElapsed(0, 4_200), "4s");
    assert.equal(formatElapsed(0, 65_000), "1m 05s");
    assert.equal(formatElapsed(0, 3_780_000), "1h 03m");
  });

  test("clock skew never yields a negative readout", () => {
    assert.equal(formatElapsed(10_000, 9_000), "0s");
  });
});

describe("SubagentStrip", () => {
  test("renders one row per running subagent with a stop control when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running]),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
        initialExpanded: true,
      }),
    );
    assert.match(html, /class="subagent-strip"/);
    assert.match(html, /class="subagent-row is-running"/);
    assert.match(html, /class="subagent-agent">General</);
    assert.match(html, /class="subagent-desc"[^>]*>Run sleep 45</);
    assert.match(html, /class="subagent-elapsed">12s</);
    assert.match(html, /class="subagent-open"/);
    assert.match(html, /class="subagent-stop"[^>]*>×<\/button>/);
  });

  test("defaults to collapsed: only the clickable head row, no pulse", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running]),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
      }),
    );
    assert.match(html, /class="subagent-strip"/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /subagent-pulse/);
    assert.doesNotMatch(html, /subagent-agent/);
    assert.doesNotMatch(html, /subagent-stop/);
  });

  test("renders nothing without running subagents", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, { jobs: [], now: 13_000, onOpen: () => {}, onStop: () => {} }),
    );
    assert.equal(html, "");
  });

  test("a failed row is red, hides its stop control and freezes the elapsed readout", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([failed]),
        now: 120_000,
        onOpen: () => {},
        onStop: () => {},
        initialExpanded: true,
      }),
    );
    assert.match(html, /class="subagent-row is-failed"/);
    assert.doesNotMatch(html, /subagent-stop/);
    assert.match(html, /class="subagent-open"/);
    // 耗时冻结在失败时刻（ended = 61_000 → 1m 00s），不随 now 继续走。
    assert.match(html, /class="subagent-elapsed">1m 00s</);
  });

  test("a blocked row is yellow and keeps its stop control", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running], new Set(["ses_child1"])),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
        initialExpanded: true,
      }),
    );
    assert.match(html, /class="subagent-row is-blocked"/);
    assert.match(html, /class="subagent-stop"[^>]*>×<\/button>/);
  });

  test("the collapsed head count is tinted red when any row failed, else yellow when blocked", () => {
    const failedHead = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running, failed]),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
      }),
    );
    assert.match(failedHead, /class="subagent-head is-failed"/);

    const blockedHead = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running], new Set(["ses_child1"])),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
      }),
    );
    assert.match(blockedHead, /class="subagent-head is-blocked"/);

    const plainHead = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running]),
        now: 13_000,
        onOpen: () => {},
        onStop: () => {},
      }),
    );
    assert.doesNotMatch(plainHead, /subagent-head is-/);
  });
});

describe("failed rows are held for 30s after the server drops them (spec D4)", () => {
  // 仓库惯例：同步 act（async act 走 React scheduler 的 MessageChannel，
  // 打开的端口会把 node 事件循环挂住，进程无法退出——见 subagent-nav
  // 的 mount 支架；卸载也包在 act 里）。
  interface Mount {
    container: HTMLElement;
    rerender: (jobs: SubagentJob[], props?: { now?: number; currentSessionId?: string }) => void;
    unmount: () => void;
  }

  const mount = (jobs: SubagentJob[], props: { now?: number } = {}): Mount => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (nextJobs: SubagentJob[], next?: { now?: number; currentSessionId?: string }) => {
      act(() => {
        root.render(
          createElement(SubagentStrip, {
            jobs: nextJobs,
            now: next?.now ?? props.now,
            onOpen: () => {},
            onStop: () => {},
            currentSessionId: next?.currentSessionId ?? "ses_parent",
            initialExpanded: true,
          }),
        );
      });
    };
    render(jobs);
    return {
      container,
      rerender: (nextJobs, next) => render(nextJobs, next),
      unmount: () => {
        act(() => {
          root.unmount();
        });
        container.remove();
      },
    };
  };

  test("a failed row stays visible for the hold window after the job list drops it", () => {
    const [errorJob] = toSubagentJobs([failed]);
    if (!errorJob) {
      throw new Error("fixture must produce a job");
    }
    const view = mount([errorJob], { now: 61_000 });

    view.rerender([], { now: 61_000 + HOLD_MS - 1_000 });
    assert.match(view.container.innerHTML, /is-failed/);

    view.rerender([], { now: 61_000 + HOLD_MS });
    assert.doesNotMatch(view.container.innerHTML, /subagent-row/);
    view.unmount();
  });

  test("switching sessions clears the held rows", () => {
    const [errorJob] = toSubagentJobs([failed]);
    if (!errorJob) {
      throw new Error("fixture must produce a job");
    }
    const view = mount([errorJob], { now: 61_000 });

    view.rerender([], { now: 62_000, currentSessionId: "ses_other" });
    assert.equal(view.container.innerHTML, "");
    view.unmount();
  });

  test("the hold window renews while the server keeps listing the failed job", () => {
    const [errorJob] = toSubagentJobs([failed]);
    if (!errorJob) {
      throw new Error("fixture must produce a job");
    }
    const view = mount([errorJob], { now: 61_000 });

    // 服务器列表里一直挂着：钉住窗口随最后一次在列时刻续期（工票 03），
    // 兜底从服务器真正移除该行那刻起算满 30s。
    view.rerender([errorJob], { now: 120_000 });
    view.rerender([], { now: 120_000 + HOLD_MS - 1_000 });
    assert.match(view.container.innerHTML, /is-failed/);

    view.rerender([], { now: 120_000 + HOLD_MS });
    assert.doesNotMatch(view.container.innerHTML, /subagent-row/);
    view.unmount();
  });
});

describe("subagents in the webview state", () => {
  test("a subagents message from the active session lands in the state", () => {
    const jobs = toSubagentJobs([running]);
    const state = reducer(
      { ...initialState, sessionID: "ses_parent" },
      { kind: "subagents", sessionID: "ses_parent", jobs },
    );
    assert.deepEqual(state.subagents, jobs);
  });

  test("a message from another session is ignored", () => {
    const state = reducer(
      { ...initialState, sessionID: "ses_parent" },
      { kind: "subagents", sessionID: "ses_other", jobs: toSubagentJobs([running]) },
    );
    assert.deepEqual(state.subagents, []);
  });
});
