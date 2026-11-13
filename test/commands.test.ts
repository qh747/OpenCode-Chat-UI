import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { filterCommands, resolveCommandAction, splitCommandInput } from "../src/util/commands";

const serverCommands = [
  { name: "init", description: "guided AGENTS.md setup" },
  { name: "review", description: "review changes [commit|branch|pr]" },
  { name: "goal", description: "keep working until an objective is met" },
];

describe("filterCommands", () => {
  test("empty query returns all commands", () => {
    assert.equal(filterCommands(serverCommands, "").length, 3);
  });

  test("filters by name prefix or substring", () => {
    assert.deepEqual(filterCommands(serverCommands, "rev").map((c) => c.name), ["review"]);
    assert.deepEqual(filterCommands(serverCommands, "ew").map((c) => c.name), ["review"]);
    assert.deepEqual(filterCommands(serverCommands, "zzz"), []);
  });

  test("query is case-insensitive", () => {
    assert.deepEqual(filterCommands(serverCommands, "INIT").map((c) => c.name), ["init"]);
  });
});

describe("resolveCommandAction", () => {
  test("maps built-in client commands", () => {
    assert.deepEqual(resolveCommandAction("new"), { kind: "client", action: "new" });
    assert.deepEqual(resolveCommandAction("undo"), { kind: "client", action: "undo" });
    assert.deepEqual(resolveCommandAction("export"), { kind: "client", action: "export" });
    assert.deepEqual(resolveCommandAction("fork"), { kind: "client", action: "fork" });
    assert.deepEqual(resolveCommandAction("compact"), { kind: "client", action: "compact" });
  });

  test("routes unknown (user-configured) commands to the server", () => {
    assert.deepEqual(resolveCommandAction("dcp"), { kind: "server" });
    assert.deepEqual(resolveCommandAction("init"), { kind: "server" });
    assert.deepEqual(resolveCommandAction("review"), { kind: "server" });
  });

  test("is case-insensitive and tolerates a leading slash", () => {
    assert.deepEqual(resolveCommandAction("/NEW"), { kind: "client", action: "new" });
  });
});

describe("splitCommandInput", () => {
  test("splits command from arguments", () => {
    assert.deepEqual(splitCommandInput("/review commit"), { command: "review", arguments: "commit" });
  });

  test("handles a bare command", () => {
    assert.deepEqual(splitCommandInput("/init"), { command: "init", arguments: "" });
  });

  test("collapses extra spaces", () => {
    assert.deepEqual(splitCommandInput("/goal   keep  working "), {
      command: "goal",
      arguments: "keep  working",
    });
  });
});
