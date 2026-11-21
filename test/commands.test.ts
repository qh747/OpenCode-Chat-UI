import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { commandTail, filterCommands, resolveCommandAction, splitCommandInput } from "../src/util/commands";

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

describe("commandTail（任意光标位置的 / 触发）", () => {
  test("光标前缀内的尾部 / 触发，查询词到光标为止", () => {
    assert.deepEqual(commandTail("/rev", 4), { query: "rev", atIndex: 0, caret: 4 });
    assert.deepEqual(commandTail("帮我 /rev", 7), { query: "rev", atIndex: 3, caret: 7 });
  });

  test("裸 / 以空查询打开完整菜单", () => {
    assert.deepEqual(commandTail("正文/", 3), { query: "", atIndex: 2, caret: 3 });
  });

  test("光标之后的 / 不触发", () => {
    assert.equal(commandTail("a/bc", 1), undefined);
  });

  test("空格断开触发段；再一个 / 会重新锚定到最近的一个", () => {
    // "/review hello"：带参后触发段已死（末尾发送路径会接住命令执行）
    assert.equal(commandTail("/review hello", 13), undefined);
    // 与 mentionTail 对 @ 的语义一致：命中光标前最近的触发字符
    assert.deepEqual(commandTail("/a/b", 4), { query: "b", atIndex: 2, caret: 4 });
  });

  test("caret 缺省为文末，越界被钳制", () => {
    assert.deepEqual(commandTail("/rev"), { query: "rev", atIndex: 0, caret: 4 });
    assert.deepEqual(commandTail("/rev", 99), { query: "rev", atIndex: 0, caret: 4 });
    assert.equal(commandTail("/rev", -1), undefined);
  });
});
