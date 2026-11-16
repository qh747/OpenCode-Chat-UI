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
});
