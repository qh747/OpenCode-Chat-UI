import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { OpencodeClient } from "../src/opencode/client";

function makeClient(calls: string[]): OpencodeClient {
  return new OpencodeClient({
    baseUrl: "http://127.0.0.1:1",
    password: "x",
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
}

describe("session-scoped client routes", () => {
  test("empty session ids are rejected before any request is made", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    await assert.rejects(
      () => client.setModel("", { providerID: "p", id: "m" }),
      /session id is required/,
    );
    await assert.rejects(() => client.setAgent("   ", "build"), /session id is required/);
    await assert.rejects(() => client.prompt("", { text: "hi" }), /session id is required/);
    assert.deepEqual(calls, []);
  });

  test("valid ids keep the expected route", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    await client.setModel("abc", { providerID: "p", id: "m" });
    assert.deepEqual(calls, ["http://127.0.0.1:1/api/session/abc/model"]);
  });

  test("a session diff can ask for the whole session's turn range", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    await client.sessionDiff("abc");
    await client.sessionDiff("abc", { from: "u1", to: "u2" });
    await client.sessionDiff("abc", { from: "u1" });
    assert.deepEqual(calls, [
      "http://127.0.0.1:1/api/session/abc/diff",
      "http://127.0.0.1:1/api/session/abc/diff?from=u1&to=u2",
      "http://127.0.0.1:1/api/session/abc/diff?from=u1",
    ]);
  });

  test("the subagent job list asks for descendants of one session", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    await client.jobs("ses_parent");
    assert.deepEqual(calls, [
      "http://127.0.0.1:1/api/experimental/job?sessionID=ses_parent&descendants=true",
    ]);
    calls.length = 0;
    await assert.rejects(() => client.jobs(""), /session id is required/);
    assert.deepEqual(calls, []);
  });

  test("form routes: list, reply, cancel", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const client = new OpencodeClient({
      baseUrl: "http://127.0.0.1:1",
      password: "x",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url));
        if (init?.body) {
          bodies.push(String(init.body));
        }
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    await client.sessionForms("ses_1");
    assert.deepEqual(calls, ["http://127.0.0.1:1/api/session/ses_1/form"]);
    // string 字段 → 纯字符串；multiselect → 字符串数组（v2.3.0 实测）。
    await client.replyForm("ses_1", "frm_1", { q0: "a", q1: ["x", "y"] });
    assert.deepEqual(calls[1], "http://127.0.0.1:1/api/session/ses_1/form/frm_1/reply");
    assert.deepEqual(JSON.parse(bodies[0] ?? ""), { answer: { q0: "a", q1: ["x", "y"] } });
    await client.cancelForm("ses_1", "frm_2", "User dismissed the questions without answering.");
    assert.equal(
      calls[2],
      "http://127.0.0.1:1/api/session/ses_1/form/frm_2?message=User%20dismissed%20the%20questions%20without%20answering.",
    );
  });

  test("message pages: limit/order on the first page, cursor alone afterwards", async () => {
    const calls: string[] = [];
    const client = makeClient(calls);
    // 无参数即历史行为：缺省页（服务器端 = 最新 50 条）。
    await client.listMessages("abc");
    await client.listMessages("abc", { limit: 100, order: "desc" });
    await client.listMessages("abc", { cursor: "c3", limit: 100 });
    assert.deepEqual(calls, [
      "http://127.0.0.1:1/api/session/abc/message",
      "http://127.0.0.1:1/api/session/abc/message?limit=100&order=desc",
      "http://127.0.0.1:1/api/session/abc/message?limit=100&cursor=c3",
    ]);
  });
});
