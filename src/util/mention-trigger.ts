/**
 * `@` 提及补全的触发检测（spec 分支 3）。
 *
 * 旧实现用 `/@([^\s@]*)$/` 匹配**全文尾部**，与光标位置无关：光标移走后
 * 弹层仍开着，`@` 出现在词中间也会误触发。这里改为只对**光标前缀**做尾部
 * 匹配——`@` 之后直到光标处不能有空格或另一个 `@`。
 */

/** 一次触发命中的全部信息：查询词、`@` 的下标、检测时的光标位置。 */
export interface MentionTail {
  /** `@` 之后的查询词，可能为空串。 */
  query: string;
  /** 触发字符 `@` 在全文中的下标。 */
  atIndex: number;
  /** 检测时使用的光标位置（已被钳制进文本范围）。 */
  caret: number;
}

/**
 * 在 `text` 的 `caret` 前缀内寻找尾部 `@` 触发。`caret` 缺省为文本末尾；
 * 越界值会被钳制。命中返回 `MentionTail`，否则 `undefined`（不触发）。
 */
export function mentionTail(text: string, caret?: number): MentionTail | undefined {
  const end =
    caret === undefined ? text.length : Math.max(0, Math.min(caret, text.length));
  const match = /@([^\s@]*)$/.exec(text.slice(0, end));
  if (!match) {
    return undefined;
  }
  return { query: match[1] ?? "", atIndex: match.index, caret: end };
}
