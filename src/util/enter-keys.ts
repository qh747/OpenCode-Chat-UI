/**
 * Composer 的 Enter 决策表（spec 分支 5：光标在末尾才发送；中途只用于确认
 * 补全——绝不发送、不执行、不换行）。
 *
 * 输入是按键瞬间的状态快照（文本、光标、菜单、高亮行、修饰键），输出一个
 * 动作；组件负责执行动作与 DOM 侧效应（preventDefault、聚焦、拼接）。纯
 * 函数，不触 DOM。中文输入法组合中的 Enter 由组件先行拦截（IME 确认候选），
 * 不进这里。
 */
import { splitCommandInput } from "./commands";
import { shouldSend, type SubmitKey } from "./composer-keys";

export type EnterAction =
  /** 发送消息（含 doSend 的命令拆分路径）。 */
  | { action: "send" }
  /** 接受菜单里的高亮行（命令/skill/文件由组件解析拼接）。 */
  | { action: "accept" }
  /** 末尾的命令语法直接执行：`/cmd` 裸跑，`/cmd args` 带参跑。 */
  | { action: "execute"; command: string; args: string }
  /** 什么都不拦：交给浏览器原生行为（换行）。 */
  | { action: "newline" }
  /** 吞掉按键：什么都不做（中途无菜单，或菜单开着但行空且光标中途）。 */
  | { action: "none" };

export interface EnterState {
  text: string;
  /** 按键瞬间的光标下标；缺省视为文末。 */
  caret?: number;
  /** 打开的补全菜单。触发存在即算打开——行数可以为 0（搜索未返回等）。 */
  menu?: "commands" | "mentions";
  /** commands = 命令+skills 总行数；mentions = 文件行数。 */
  rows: number;
  /** 高亮行下标。 */
  activeIndex?: number;
  shift: boolean;
  submitKey: SubmitKey;
  ctrlKey: boolean;
  metaKey: boolean;
}

function sendOrNewline(s: EnterState): EnterAction {
  return shouldSend(s.submitKey, { shiftKey: s.shift, ctrlKey: s.ctrlKey, metaKey: s.metaKey })
    ? { action: "send" }
    : { action: "newline" };
}

export function resolveEnter(s: EnterState): EnterAction {
  // Shift+Enter 恒为换行：不拦截，交给浏览器原生行为（与旧实现一致）。
  if (s.shift) {
    return { action: "newline" };
  }
  const caret = s.caret ?? s.text.length;
  const atEnd = caret >= s.text.length;
  const acceptable = s.menu !== undefined && s.rows > 0 && (s.activeIndex ?? 0) < s.rows;
  // 有高亮行：任何光标位置都优先确认补全，绝不发送。
  if (acceptable) {
    return { action: "accept" };
  }
  if (s.menu === "commands") {
    // 行空（查无此令）：中途不动作；末尾的命令语法仍执行，
    // 正文中间的 `/` 查无匹配则按普通消息发送。
    if (!atEnd) {
      return { action: "none" };
    }
    if (s.text.startsWith("/")) {
      const { command, arguments: args } = splitCommandInput(s.text);
      if (command) {
        return { action: "execute", command, args };
      }
      return { action: "none" };
    }
    return sendOrNewline(s);
  }
  if (s.menu === "mentions" && !atEnd) {
    // 文件搜索未返回：中途不动作也不发送——现状会把整条消息发走（缺陷点）。
    return { action: "none" };
  }
  if (!atEnd) {
    // 中途无菜单：什么都不做（用户定案——不发送、不换行）。
    return { action: "none" };
  }
  return sendOrNewline(s);
}
