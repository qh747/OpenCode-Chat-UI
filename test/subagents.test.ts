import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentStrip } from "../webview-ui/SubagentStrip";
import { reducer, initialState } from "../webview-ui/state";
import { formatElapsed, toSubagentJobs } from "../src/util/subagents";
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

const finished: JobInfo = {
  ...running,
  id: "ses_child2",
  childSessionID: "ses_child2",
  status: "completed",
  agent: "Explore",
  description: "Find the auth module",
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
  test("keeps only running subagent jobs", () => {
    const jobs = toSubagentJobs([running, finished, shell, image]);
    assert.deepEqual(
      jobs.map((job) => job.childSessionID),
      ["ses_child1"],
    );
    assert.equal(jobs[0]?.agent, "General");
    assert.equal(jobs[0]?.description, "Run sleep 45");
    assert.equal(jobs[0]?.started, 1_000);
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
        onStop: () => {},
        initialExpanded: true,
      }),
    );
    assert.match(html, /class="subagent-strip"/);
    assert.match(html, /class="subagent-agent">General</);
    assert.match(html, /class="subagent-desc"[^>]*>Run sleep 45</);
    assert.match(html, /class="subagent-elapsed">12s</);
    assert.match(html, /class="subagent-stop"[^>]*>×<\/button>/);
  });

  test("defaults to collapsed: only the clickable head row, no pulse", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentStrip, {
        jobs: toSubagentJobs([running]),
        now: 13_000,
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
      createElement(SubagentStrip, { jobs: [], now: 13_000, onStop: () => {} }),
    );
    assert.equal(html, "");
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
