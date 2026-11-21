import type { AssistantMessage, MessageInfo } from "../opencode/types";

/** Server paths use the worktree's separators; compare them normalized. */
export function diffFileKey(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function serverUserTurns(messages: MessageInfo[]): string[] {
  return messages
    .filter((message) => message.type === "user" && !message.id.startsWith("local-"))
    .map((message) => message.id);
}

/** The message-id range `GET /api/session/{id}/diff` needs. */
export interface DiffRange {
  from?: string;
  to?: string;
}

/**
 * The range `GET /api/session/{id}/diff` needs to describe the whole session.
 *
 * Without `from`/`to` the server diffs only the turn of the newest user
 * message, so a follow-up "thanks" turn (or any turn without edits) emptied
 * the changed-files list even though earlier turns had changed files.
 */
export function diffRange(messages: MessageInfo[]): DiffRange {
  const turns = serverUserTurns(messages);
  if (turns.length === 0) {
    return {};
  }
  return { from: turns[0], to: turns[turns.length - 1] };
}

/** 可校验写类：write/edit 的 input.path 必有（v2.3.0 schema 实测）。 */
const WRITE_TOOLS = new Set(["write", "edit"]);

/** 工具输入路径归一：分隔符/./ 前缀归一后，workspace 内的绝对路径相对化。
 *  前缀比较大小写不敏感：Windows 盘符大小写在服务器 diff 路径与工具输入
 *  两个来源之间并不一致（H:\ 与 h:\），按大小写比对会漏掉真实行。 */
function writePathKey(path: string, workspacePath?: string): string {
  let key = diffFileKey(path);
  if (!workspacePath) {
    return key;
  }
  const ws = diffFileKey(workspacePath).replace(/\/+$/, "");
  const head = key.slice(0, ws.length);
  if (
    ws !== "" &&
    head.toLowerCase() === ws.toLowerCase() &&
    key.charAt(ws.length) === "/"
  ) {
    key = key.slice(ws.length + 1);
  }
  return key;
}

/**
 * 会话的归因集合（GLOSSARY「Attribution set」）：本会话自己的写类工具
 * 调用（write/edit）的 input.path 命中的文件——唯一无歧义的会话级事实。
 *
 * `snapshot.files` 不是"本会话 agent 碰过什么"的记录，而是一条消息自带
 * 的 [snapshot.start → snapshot.end] 窗口内共享工作树的内容差——窗口内
 * 任何来源的改动（他会话回合、扩展直接写盘、用户手工编辑）都会被算进
 * 这条消息的 files，与该回合是否调用过工具无关（server-snapshot-
 * attribution/01 双向实证）。因此快照声明整体退出归属判定：一条消息
 * 无论声明了什么，只有它自己的 write/edit 输入命中的路径才被认领。
 *
 * 由此所有豁免通道不复存在：
 * - shell/patch/execute、未知名或无名的调用一律不认领——shell 重定向
 *   写盘的改动会漏显示，以"漏行"换"串行"，方向单向（ADR-0008
 *   2026-11-22 修订；产品拍板：会话绑定优先于零假阴性）。
 * - `tools` 字段缺失（老服务器形态）不改变结果：归属只看 write/edit
 *   调用本身，content tool parts 通道照常生效。
 * - write/edit 缺 input.path 的调用不认领。
 *
 * 会话没写过文件 → 集合为空 → 列表为空（ADR-0008），他人的改动没有
 * 任何通道可进。
 */
export function attributionSet(messages: MessageInfo[], workspacePath?: string): Set<string> {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const assistant = message as AssistantMessage;
    // 双通道并集（spec 增补 Q5）：顶层 tools[].input 与 content tool parts
    // 的 state.input 都记录工具调用，两通道合并成一个调用集再筛 write/edit。
    const calls: { name?: string; input?: Record<string, unknown> }[] = [];
    for (const call of assistant.tools ?? []) {
      calls.push(call);
    }
    for (const part of assistant.content) {
      if (part.type === "tool") {
        calls.push({ name: part.name, input: part.state.input });
      }
    }
    for (const call of calls) {
      if (!WRITE_TOOLS.has(call.name ?? "")) {
        continue;
      }
      const path = call.input?.path;
      // write/edit 缺 input.path：不可校验 → 不认领（零豁免）。
      if (typeof path === "string" && path !== "") {
        files.add(writePathKey(path, workspacePath));
      }
    }
  }
  return files;
}
