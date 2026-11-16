import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildFormAnswer, formAnswerComplete, QuestionForm } from "../webview-ui/QuestionForm";
import { initialState, reducer } from "../webview-ui/state";
import { formEventSession } from "../src/webview/panel";
import type { FormField, FormInfo } from "../src/opencode/types";
import type { HostToWeb, Snapshot } from "../src/webview/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fields: FormField[] = [
  {
    key: "q0",
    type: "string",
    title: "方案选择",
    options: [
      { value: "breaking", label: "Breaking change" },
      { value: "compat", label: "Compatibility layer" },
    ],
    custom: true,
    required: true,
  },
  {
    key: "q1",
    type: "multiselect",
    title: "影响范围",
    options: [
      { value: "api", label: "API" },
      { value: "docs", label: "Docs" },
    ],
  },
];

const form: FormInfo = {
  id: "frm_1",
  sessionID: "ses_1",
  title: "Questions",
  metadata: { kind: "question" },
  fields,
};

describe("form answer assembly (verified against v2.3.0)", () => {
  test("a string field answers with a plain string, not an array", () => {
    const answer = buildFormAnswer(fields, { q0: "compat", q1: [] });
    assert.equal(answer.q0, "compat");
  });

  test("a multiselect field answers with an array of strings", () => {
    const answer = buildFormAnswer(fields, { q0: "compat", q1: ["api", "docs"] });
    assert.deepEqual(answer.q1, ["api", "docs"]);
  });

  test("a non-empty custom answer overrides the picked option", () => {
    const answer = buildFormAnswer(fields, { q0: "自定义回答", q1: [] });
    assert.equal(answer.q0, "自定义回答");
  });

  test("multiselect custom text is appended to the selections", () => {
    const answer = buildFormAnswer(fields, { q0: "compat", q1: ["api", "加一个新维度"] });
    assert.deepEqual(answer.q1, ["api", "加一个新维度"]);
  });

  test("required validation gates submit", () => {
    assert.equal(formAnswerComplete(fields, { q0: "", q1: [] }), false);
    assert.equal(formAnswerComplete(fields, { q0: "compat", q1: [] }), true);
  });
});

describe("forms in the chat state", () => {
  const snapshot = (forms: FormInfo[]): Snapshot => ({
    sessionID: "ses_1",
    busy: true,
    messages: [],
    pending: [],
    diffs: [],
    catalog: { agents: [], models: [], commands: [], skills: [], recentModels: [] },
    queue: [],
    queuePaused: false,
    forms,
  });

  test("a snapshot carries pending forms", () => {
    const state = reducer(initialState, { kind: "snapshot", snapshot: snapshot([form]) });
    assert.deepEqual(state.forms, [form]);
  });

  test("forms for another session are ignored", () => {
    const state = reducer(initialState, { kind: "snapshot", snapshot: snapshot([]) });
    const next = reducer(state, { kind: "forms", sessionID: "ses_other", forms: [form] });
    assert.deepEqual(next.forms, []);
  });

  test("the forms message updates the current session's list", () => {
    const state = reducer(initialState, { kind: "snapshot", snapshot: snapshot([]) });
    const next = reducer(state, { kind: "forms", sessionID: "ses_1", forms: [form] });
    assert.deepEqual(next.forms, [form]);
  });
});

describe("question card rendering", () => {
  test("options, custom input and actions render for a pending form", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionForm, {
        form,
        onReply: () => {},
        onCancel: () => {},
      }),
    );
    assert.match(html, /Breaking change/);
    assert.match(html, /Compatibility layer/);
    // 选项带字母前缀 A. B. C. …
    assert.match(html, /q-option-key/);
    assert.match(html, />A\.</);
    assert.match(html, />B\.</);
    assert.match(html, /q-custom/);
    assert.match(html, /question-buttons/);
    assert.match(html, />Submit</);
  });

  test("hidden fields are not rendered", () => {
    const hiddenForm: FormInfo = {
      ...form,
      fields: [{ key: "q0", type: "string", hidden: true, required: true }],
    };
    const html = renderToStaticMarkup(
      createElement(QuestionForm, { form: hiddenForm, onReply: () => {}, onCancel: () => {} }),
    );
    assert.doesNotMatch(html, /Breaking change/);
  });
});

// 协议回环：宿主消息能被 reducer 消化（类型守卫测试）。
describe("host-to-web form messages", () => {
  test("forms message kind exists on the protocol", () => {
    const message: HostToWeb = { kind: "forms", sessionID: "ses_1", forms: [] };
    const next = reducer(initialState, message);
    assert.deepEqual(next.forms, []);
  });
});

// form.created 的会话归属：实测 v2.3.0 顶层 data 无 sessionID，只在 data.form 里。
describe("formEventSession (v2.3.0 payload regression)", () => {
  // 2026-11-17 实测捕获的真实载荷形状：
  // { type:"form.created", data:{ form:{ id, sessionID, title, fields } } }
  test("derives the session from the nested form object (live v2.3.0 shape)", () => {
    const data = {
      form: { id: "frm_1", sessionID: "ses_a", title: "t", fields: [] },
    };
    assert.equal(formEventSession(data), "ses_a");
  });

  test("prefers the top-level sessionID when present (form.replied shape)", () => {
    const data = { id: "frm_1", sessionID: "ses_b", form: { sessionID: "ses_a" } };
    assert.equal(formEventSession(data), "ses_b");
  });

  test("yields undefined when neither location carries a session", () => {
    assert.equal(formEventSession({}), undefined);
    assert.equal(formEventSession({ form: { id: "frm_1" } }), undefined);
  });
});
