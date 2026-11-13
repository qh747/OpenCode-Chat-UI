import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { locationQuery } from "../src/util/catalog-params";

describe("locationQuery", () => {
  test("builds a deepObject-style location[directory] query (verified on 2.3.0)", () => {
    assert.equal(
      locationQuery("H:/MyCode/opencode-plugin"),
      `location%5Bdirectory%5D=${encodeURIComponent("H:/MyCode/opencode-plugin")}`,
    );
  });

  test("escapes the directory value", () => {
    const q = locationQuery("a b&c");
    assert.ok(q.includes("a%20b%26c"));
  });
});
