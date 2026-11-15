import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { initialState, reducer } from "../webview-ui/state";

describe("pre-session picker choices", () => {
  test("sessionMeta without a session id updates the empty panel", () => {
    const next = reducer(initialState, {
      kind: "sessionMeta",
      agent: "plan",
      model: { providerID: "opencode", id: "gemini" },
    });
    assert.equal(next.agent, "plan");
    assert.equal(next.model?.providerID, "opencode");
    assert.equal(next.model?.id, "gemini");
  });
});
