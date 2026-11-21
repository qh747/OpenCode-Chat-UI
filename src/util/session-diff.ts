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

/**
 * v2.3.0 内置工具全集（binary schema 提取；调查记录见
 * .scratch/diff-list-memory/issues/04-attribution-tool-crosscheck.md）。
 * 全集外的名字保守豁免：未来服务器版本可能新增可写盘工具，误过滤会丢真实改动。
 */
const KNOWN_TOOLS = new Set([
  "shell",
  "glob",
  "read",
  "grep",
  "webfetch",
  "websearch",
  "write",
  "edit",
  "subagent",
  "execute",
  "patch",
  "todowrite",
  "question",
  "skill",
]);

/** 旧版工具名归一（V1 名 → v2.3.0 名），归一后再分类。 */
const LEGACY_NAMES: Record<string, string> = {
  bash: "shell",
  apply_patch: "patch",
  task: "subagent",
};

/** 可校验写类：v2.3.0 中 write/edit 的 input.path 必有（schema 实测）。 */
const WRITE_TOOLS = new Set(["write", "edit"]);

/** 能写盘但无法廉价提取目标路径的写类工具 → 整条消息豁免（保留全归因）。 */
const UNVERIFIABLE_TOOLS = new Set(["shell", "patch", "execute"]);

/** 一条 assistant 消息的归因裁定：全量保留，或只认可写路径交集。 */
interface MessageVerdict {
  /** 无法校验（unknown/豁免）→ snapshot.files 全部保留。 */
  keepAll: boolean;
  /** 可校验写路径集（diffFileKey 归一后）。 */
  writePaths: Set<string>;
}

function toolName(call: { name?: string }): string {
  const raw = call.name ?? "";
  return LEGACY_NAMES[raw] ?? raw;
}

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

function messageVerdict(assistant: AssistantMessage, workspacePath?: string): MessageVerdict {
  // 双通道并集（spec 增补 Q5）：顶层 tools[].input 与 content tool parts
  // 的 state.input 都记录工具调用，两通道合并成一个调用集再分类。
  const calls: { name?: string; input?: Record<string, unknown> }[] = [];
  for (const call of assistant.tools ?? []) {
    calls.push(call);
  }
  for (const part of assistant.content) {
    if (part.type === "tool") {
      calls.push({ name: part.name, input: part.state.input });
    }
  }
  if (calls.length === 0) {
    // 两通道都拿不到调用：tools 缺失 = unknown（保留全归因）；
    // tools: [] = 明确无调用（其快照声明全部外来）。
    return assistant.tools === undefined
      ? { keepAll: true, writePaths: new Set() }
      : { keepAll: false, writePaths: new Set() };
  }
  const writePaths = new Set<string>();
  let keepAll = false;
  for (const call of calls) {
    const name = toolName(call);
    // 单条调用缺名字 = unknown：保守豁免。
    if (name === "") {
      keepAll = true;
    } else if (WRITE_TOOLS.has(name)) {
      // write/edit 必带 input.path（v2.3.0 schema）；缺失则该调用不可校验。
      const path = call.input?.path;
      if (typeof path === "string" && path !== "") {
        writePaths.add(writePathKey(path, workspacePath));
      } else {
        keepAll = true;
      }
    } else if (UNVERIFIABLE_TOOLS.has(name) || !KNOWN_TOOLS.has(name)) {
      // 能写盘但无路径可提取（shell/patch/execute），或未知名 → 保守豁免。
      keepAll = true;
    }
    // 其余已知非写类（read/grep/glob/subagent/...）不贡献路径：该消息
    // 不可能自己写盘，窗口内的改动均属外来（第二阶泄漏的过滤）。
  }
  return { keepAll, writePaths };
}

/**
 * 会话的归因集合（GLOSSARY「Attribution set」）：本会话回合自己写下的文件，
 * 按 assistant 消息逐条裁定。
 *
 * `snapshot.files` 是一条消息自身快照窗口内共享工作树的内容差——任何来源
 * （他会话回合、面板自己的 revert、手工编辑）落进窗口都会被记入，raw 声明
 * 会跨会话串行。逐条消息：
 *
 * - `tools` 缺失 → unknown，保留全归因（零假阴性；spec 增补 Q21/Q3）。
 * - `tools: []` → 该消息没调用过工具，其快照声明全部视为外来。
 * - 任何能写盘但无法廉价提取目标路径的调用（shell/patch/execute），或未知
 *   工具名 → 不可校验，保留全归因。
 * - 否则该消息只可能通过 write/edit 输入写盘，可信行是
 *   `snapshot.files ∩ 写路径`（per-file cross-check；二阶泄漏修复——
 *   ADR-0008 第三修订节）。
 */
export function attributionSet(messages: MessageInfo[], workspacePath?: string): Set<string> {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const assistant = message as AssistantMessage;
    const verdict = messageVerdict(assistant, workspacePath);
    const claimed = assistant.snapshot?.files ?? [];
    for (const file of claimed) {
      const key = diffFileKey(file);
      // keepAll：无法校验，保留全归因（宁可全量，不丢真实改动）；
      // 否则只认可该消息写类工具输入命中的路径。
      if (verdict.keepAll || verdict.writePaths.has(key)) {
        files.add(key);
      }
    }
  }
  return files;
}
