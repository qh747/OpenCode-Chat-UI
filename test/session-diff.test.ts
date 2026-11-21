import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { diffFileKey, diffRange, attributionSet } from "../src/util/session-diff";
import type { AssistantToolCall, MessageInfo } from "../src/opencode/types";

function assistant(files: string[]): MessageInfo {
  return { type: "assistant", id: `a_${files.join("_")}`, time: { created: 1 }, content: [], snapshot: { files } };
}

/** 带 tools 的 assistant 消息：归属反转后过滤器认的输入形状——write/edit
 *  的 input.path 参与归属，其余调用不认领（v2.3.0 live 形状）。 */
function assistantWithTools(files: string[], tools: AssistantToolCall[]): MessageInfo {
  return {
    type: "assistant",
    id: `a_${tools.map((tool) => tool.name).join("_")}_${files.join("_")}`,
    time: { created: 1 },
    content: [],
    snapshot: { files },
    tools,
  };
}

describe("session diff range", () => {
  test("spans from the first to the newest server user turn", () => {
    const messages: MessageInfo[] = [
      { type: "user", id: "u1", time: { created: 1 }, text: "one" },
      assistant(["a.ts"]),
      { type: "user", id: "u2", time: { created: 2 }, text: "two" },
      assistant([]),
    ];
    assert.deepEqual(diffRange(messages), { from: "u1", to: "u2" });
  });

  test("local optimistic bubbles are not server turn ids", () => {
    const messages: MessageInfo[] = [
      { type: "user", id: "u1", time: { created: 1 }, text: "one" },
      { type: "user", id: "local-123", time: { created: 2 }, text: "pending" },
    ];
    assert.deepEqual(diffRange(messages), { from: "u1", to: "u1" });
  });

  test("no server turns means no range parameters", () => {
    assert.deepEqual(diffRange([]), {});
  });
});

describe("session diff file attribution", () => {
  test("a snapshot claim without write calls attributes nothing", () => {
    // 归属反转（ADR-0008 2026-11-22 修订）：`snapshot.files` 是共享树窗口差
    // （server-snapshot-attribution/01 实证），声明本身不再参与归属。
    // 没有 write/edit 调用的消息无论声明什么都一无所获。
    const files = attributionSet([
      assistant(["a.ts", "src\\b.ts"]),
      assistant(["src/b.ts", "./c.ts"]),
    ]);
    assert.deepEqual([...files], []);
  });

  test("a message with no tool calls cannot attribute its snapshot files", () => {
    // Server reality (server-snapshot-attribution/01): a message's
    // snapshot.files lists whatever changed in the shared working tree
    // inside its own snapshot window — a chat-only turn (`tools: []`) whose
    // window framed another session's write claims that file without having
    // touched it. No tool calls, no credibility: its files are foreign.
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_chat",
      time: { created: 1 },
      content: [],
      snapshot: { files: ["a.md"] },
      tools: [],
    };
    assert.deepEqual([...attributionSet([message])], []);
  });

  test("keeps only the files its write tools touched", () => {
    // 归属反转（ADR-0008 2026-11-22 修订）：带工具调用的消息里，只有它
    // 自己 write/edit 输入命中的路径才被认领——快照窗口框住的外来写
    // （他会话回合落进窗口）不因声明而获得归属。
    const message = assistantWithTools(
      ["a.md", "src/b.ts"],
      [{ name: "write", status: "completed", input: { path: "a.md" } }],
    );
    assert.deepEqual([...attributionSet([message])], ["a.md"]);
  });

  test("a write call without a path contributes nothing", () => {
    // 零豁免：write/edit 缺 input.path 的调用不可校验 → 不认领该调用。
    // 旧语义在此全量豁免整条消息，随归属反转关闭。
    const message = assistantWithTools(
      ["a.md"],
      [{ name: "write", status: "completed", input: { content: "x" } }],
    );
    assert.deepEqual([...attributionSet([message])], []);
  });

  test("drops snapshot files a read-only message cannot have written", () => {
    // Session-B scenario: an analysis turn that only read frames another
    // session's writes inside its snapshot window. Known non-write tools
    // cannot have produced those files, so every claim is foreign.
    const message = assistantWithTools(
      ["a.md"],
      [{ name: "read", status: "completed", input: { path: "a.md" } }],
    );
    assert.deepEqual([...attributionSet([message])], []);
  });

  test("shell and patch calls attribute nothing by themselves", () => {
    // 归属反转：shell/patch/execute 能写盘但无法廉价提取路径——旧语义在
    // 此全量豁免（正是串扰入口），新语义一律不认领。shell 重定向写的
    // 真实改动会漏显示（已拍板的代价），外来文件则无通道可进。
    const shelled = assistantWithTools(
      ["a.md", "src/b.ts"],
      [{ name: "shell", status: "completed", input: { command: "echo hi > a.md" } }],
    );
    const patched = assistantWithTools(
      ["a.md"],
      [{ name: "patch", status: "completed", input: { patchText: "*** Update File: a.md" } }],
    );
    assert.deepEqual([...attributionSet([shelled])], []);
    assert.deepEqual([...attributionSet([patched])], []);
  });

  test("legacy tool names attribute nothing either", () => {
    // V1 名（bash/apply_patch/task）与新名（shell/patch/subagent）结果一致：
    // 都不在 write/edit 集合内，不认领。旧语义靠归一把 bash/apply_patch
    // 送进豁免通道，随归属反转一并关闭。
    const bash = assistantWithTools(["a.md"], [{ name: "bash", status: "completed", input: { command: "ls" } }]);
    const legacyPatch = assistantWithTools(["a.md"], [
      { name: "apply_patch", status: "completed", input: { patchText: "*** Add File: a.md" } },
    ]);
    const legacyTask = assistantWithTools(["child.md"], [
      { name: "task", status: "completed", input: { description: "do things" } },
    ]);
    assert.deepEqual([...attributionSet([bash])], []);
    assert.deepEqual([...attributionSet([legacyPatch])], []);
    assert.deepEqual([...attributionSet([legacyTask])], []);
  });

  test("a tools-less legacy message with no tool parts attributes nothing", () => {
    // 老服务器消息缺 tools 字段、content 也无 tool parts：没有任何
    // write/edit 调用记录 → 不认领。旧语义的 "missing = unknown =
    // trusted" 是最后一个豁免通道，随归属反转一并关闭。
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_legacy",
      time: { created: 1 },
      content: [],
      snapshot: { files: ["a.md"] },
    };
    assert.deepEqual([...attributionSet([message])], []);
  });

  test("unions write paths from top-level tools and content tool parts", () => {
    // Q5: 双通道并集——顶层 tools[].input 与 content tool parts 的
    // state.input 都记录工具调用，哪条能提取到 path 就用哪条。
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_dual",
      time: { created: 1 },
      content: [
        { type: "tool", id: "part_edit", name: "edit", state: { status: "completed", input: { path: "src/b.ts" }, content: [] } },
      ],
      snapshot: { files: ["a.md", "src/b.ts", "c.md"] },
      tools: [{ name: "write", status: "completed", input: { path: "a.md" } }],
    };
    assert.deepEqual([...attributionSet([message])], ["a.md", "src/b.ts"]);
  });

  test("classifies by content tool parts when the top-level tools list is empty", () => {
    // 旧形状：顶层 tools 为空数组但 content 里仍有调用记录；调用集
    // 非空时按调用分类，而不是当作"无调用"整体丢弃。
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_parts_only",
      time: { created: 1 },
      content: [
        { type: "tool", id: "part_write", name: "write", state: { status: "completed", input: { path: "a.md" }, content: [] } },
      ],
      snapshot: { files: ["a.md", "b.md"] },
      tools: [],
    };
    assert.deepEqual([...attributionSet([message])], ["a.md"]);
  });

  test("classifies by content tool parts even when the tools field is absent", () => {
    // Q5 定案：两通道都拿不到调用才回退 unknown 全量保留；tools 缺失
    // 但 parts 在场时 parts 仍代表消息说话（锁定，防回归到无条件全量）。
    const message: MessageInfo = {
      type: "assistant",
      id: "msg_no_tools_with_parts",
      time: { created: 1 },
      content: [
        { type: "tool", id: "part_write", name: "write", state: { status: "completed", input: { path: "a.md" }, content: [] } },
      ],
      snapshot: { files: ["a.md", "b.md"] },
      tools: undefined,
    };
    assert.deepEqual([...attributionSet([message])], ["a.md"]);
  });

  test("relativizes absolute write paths inside the workspace", () => {
    // 模型偶尔给绝对路径；workspace 内的绝对路径先相对化再比对，
    // 避免真实改动被误判为外来。
    const message = assistantWithTools(
      ["a.md"],
      [{ name: "write", status: "completed", input: { path: "/ws/a.md" } }],
    );
    assert.deepEqual([...attributionSet([message], "/ws")], ["a.md"]);
  });

  test("relativizes workspace prefixes case-insensitively", () => {
    // Windows 盘符大小写在服务器 diff 路径与工具输入两个来源之间并不
    // 一致（H:\ 与 h:\）；前缀按大小写比对会把真实行误判为外来。
    const message = assistantWithTools(
      ["a.md"],
      [{ name: "write", status: "completed", input: { path: "H:/ws/a.md" } }],
    );
    assert.deepEqual([...attributionSet([message], "h:/ws")], ["a.md"]);
  });

  test("normalizes separators for comparing server diff paths", () => {
    assert.equal(diffFileKey("src\\webview\\panel.ts"), "src/webview/panel.ts");
    assert.equal(diffFileKey("./test.md"), "test.md");
  });
});
