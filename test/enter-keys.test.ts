import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { resolveEnter, type EnterState } from "../src/util/enter-keys";

function state(overrides: Partial<EnterState>): EnterState {
  return {
    text: "",
    caret: 0,
    shiftKey: false,
    submitKey: "enter",
    ctrlKey: false,
    metaKey: false,
    rows: 0,
    ...overrides,
  };
}

describe("resolveEnter 决策表（光标在末尾才发送）", () => {
  test("菜单开着且有高亮行：任何光标位置都优先接受，绝不发送", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "/rev", caret: 2, menu: "commands", rows: 2, activeIndex: 1 })),
      { action: "accept" },
    );
    assert.deepEqual(
      resolveEnter(state({ text: "@看看", caret: 1, menu: "mentions", rows: 3, activeIndex: 0 })),
      { action: "accept" },
    );
    assert.deepEqual(
      resolveEnter(state({ text: "hello /rev", caret: 10, menu: "commands", rows: 1, activeIndex: 0 })),
      { action: "accept" },
    );
  });

  test("菜单开着但行空、光标中途：什么都不做", () => {
    // 现状缺陷：@ 行空时会把整条消息发走
    assert.deepEqual(
      resolveEnter(state({ text: "@看看这段代码", caret: 1, menu: "mentions", rows: 0 })),
      { action: "none" },
    );
    assert.deepEqual(
      resolveEnter(state({ text: "/写一段代码", caret: 1, menu: "commands", rows: 0 })),
      { action: "none" },
    );
  });

  test("命令行空、光标末尾、裸命令：直接执行", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "/unknown", caret: 8, menu: "commands", rows: 0 })),
      { action: "execute", command: "unknown", args: "" },
    );
  });

  test("带参命令（/cmd args）的触发段已被空格终止：菜单不开，走发送路径执行", () => {
    // 生产里 menu 不可能为 commands（空格杀死触发段）——此形态经无菜单分支发送，
    // 由 doSend 的命令拆分执行；见 composer-enter.test.tsx 的真 DOM 用例。
    assert.deepEqual(
      resolveEnter(state({ text: "/review hello world", caret: 19, rows: 0 })),
      { action: "send" },
    );
  });

  test("命令行空、光标末尾、正文中间的 /：按普通消息发送", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "帮我 /review 一下", caret: 13, menu: "commands", rows: 0 })),
      { action: "send" },
    );
  });

  test("@ 行空、光标末尾：照常发送（@ 作字面文本）", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "@不存在的文件", caret: 7, menu: "mentions", rows: 0 })),
      { action: "send" },
    );
  });

  test("无菜单、光标中途：什么都不做（不发送、不换行）", () => {
    // 现状缺陷：中途 Enter 直接把消息发走
    assert.deepEqual(
      resolveEnter(state({ text: "第一行第二行", caret: 3, rows: 0 })),
      { action: "none" },
    );
  });

  test("无菜单、光标末尾：按提交键发送", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "写完了", caret: 3, rows: 0 })),
      { action: "send" },
    );
    // caret 缺省视为文末
    assert.deepEqual(
      resolveEnter(state({ text: "写完了", caret: undefined, rows: 0 })),
      { action: "send" },
    );
  });

  test("Shift+Enter 恒为换行（任何位置、菜单开关）", () => {
    assert.deepEqual(resolveEnter(state({ text: "abc", caret: 1, shiftKey: true, rows: 0 })), {
      action: "newline",
    });
    assert.deepEqual(
      resolveEnter(state({ text: "/rev", caret: 4, shiftKey: true, menu: "commands", rows: 2, activeIndex: 0 })),
      { action: "newline" },
    );
  });

  test("ctrlEnter 模式：裸 Enter 换行，Ctrl/Cmd+Enter 发送，中途无菜单仍无操作", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "写完了", caret: 3, submitKey: "ctrlEnter", rows: 0 })),
      { action: "newline" },
    );
    assert.deepEqual(
      resolveEnter(state({ text: "写完了", caret: 3, submitKey: "ctrlEnter", ctrlKey: true, rows: 0 })),
      { action: "send" },
    );
    assert.deepEqual(
      resolveEnter(state({ text: "第一行第二行", caret: 3, submitKey: "ctrlEnter", rows: 0 })),
      { action: "none" },
    );
  });

  test("行数大于 0 但高亮越界：按行空处理", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "/xy", caret: 2, menu: "commands", rows: 1, activeIndex: 1 })),
      { action: "none" },
    );
  });

  test("macOS ⌘+Enter 在 ctrlEnter 模式下发送", () => {
    assert.deepEqual(
      resolveEnter(state({ text: "ok", caret: 2, submitKey: "ctrlEnter", metaKey: true, rows: 0 })),
      { action: "send" },
    );
  });
});
