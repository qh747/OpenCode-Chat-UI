// 真实 DOM 反馈环（diagnosing-bugs Phase 1，同 composer-switch 的做法）：
// Enter 决策表（spec 分支 5）的光标位置依赖 textarea 的实时选区，静态渲染
// 跑不到键盘事件，这里用 jsdom 跑真实的 createRoot，直接断言用户症状：
// 光标中途按 Enter 不许把消息/命令发出去；接受补全在光标处拼接、保留正文。
// 全局 DOM 设置必须是第一个 import（ESM import 提升，见 dom-setup.ts）。
import { dom } from "./dom-setup";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { App } from "../webview-ui/app";
import { initialState, reducer } from "../webview-ui/state";
import type { ChatState } from "../webview-ui/state";
import type { Catalog, HostToWeb } from "../src/webview/protocol";

const catalog: Catalog = {
  agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
  models: [{ providerID: "opencode", modelID: "deepseek", name: "DeepSeek V4.1 Flash" }],
  commands: [{ name: "review", description: "review changes" }],
  skills: [],
  recentModels: [],
  defaultModel: { providerID: "opencode", id: "deepseek" },
};

function bootedState(): ChatState {
  const messages: HostToWeb[] = [
    { kind: "state", state: "connected", version: "1.2.3" },
    { kind: "catalog", catalog },
    {
      kind: "snapshot",
      snapshot: {
        sessionID: "ses_enter",
        title: "T",
        agent: "build",
        model: { providerID: "opencode", id: "deepseek" },
        busy: false,
        messages: [],
        pending: [],
        diffs: [],
        catalog,
        queue: [],
        queuePaused: false,
      },
    },
  ];
  return messages.reduce(reducer, initialState);
}

/** 模拟输入：替换整个值，先把光标钉到 pos，再触发 input —— React onChange
 *  读到的 selectionStart 必须是目标位置（决策表吃按键瞬间的实时选区）。 */
function typeInto(textarea: HTMLTextAreaElement, value: string, pos?: number): void {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.setSelectionRange(pos ?? value.length, pos ?? value.length);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function pressEnter(textarea: HTMLTextAreaElement, shift = false): void {
  textarea.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: shift, bubbles: true }),
  );
}

describe("composer enter decisions (real DOM)", () => {
  let root: Root;
  let container: HTMLElement;
  let handleRef: { current: { setChips: (items: { path: string }[]) => void } | undefined };
  let sent: { kind?: string; text?: string; command?: string }[];

  function textarea(): HTMLTextAreaElement {
    const el = document.querySelector("textarea");
    assert.ok(el, "composer textarea must be mounted");
    return el as HTMLTextAreaElement;
  }

  function render(): void {
    act(() => {
      root.render(
        createElement(App, {
          state: bootedState(),
          send: (msg) => sent.push(msg as { kind?: string }),
          composerHandleRef: handleRef as never,
        }),
      );
    });
  }

  function setup(): void {
    container = document.getElementById("root") as HTMLElement;
    handleRef = { current: undefined };
    sent = [];
    root = createRoot(container);
    render();
  }

  test("光标中途、无菜单：Enter 不发送、不换行、文本原样", () => {
    setup();
    act(() => {
      typeInto(textarea(), "第一行第二行", 3);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.equal(sent.length, 0, "中途 Enter 不得发送");
    assert.equal(textarea().value, "第一行第二行", "文本不得被清空");
    assert.ok(!textarea().value.includes("\n"), "中途 Enter 不得插入换行");
    root.unmount();
  });

  test("光标末尾：Enter 发送消息", () => {
    setup();
    act(() => {
      typeInto(textarea(), "写完了", 3);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.ok(
      sent.some((m) => m.kind === "send" && m.text === "写完了"),
      "末尾 Enter 应发送",
    );
    assert.equal(textarea().value, "");
    root.unmount();
  });

  test("正文中间输入 /、菜单未过滤打开：Enter 接受高亮项而不是执行命令", () => {
    setup();
    // 现状缺陷复现路径：正文「帮我 review 一下」→ 最前输 / → Enter 抢先执行
    act(() => {
      typeInto(textarea(), "帮我 review 一下", 0);
    });
    act(() => {
      typeInto(textarea(), "/帮我 review 一下", 1);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.equal(sent.length, 0, "中途 Enter 不得执行乱码命令，也不得发送");
    // 菜单未过滤（query 空）→ Enter 接受高亮第一行：触发段原位拼接，正文保留
    assert.equal(textarea().value, "/new 帮我 review 一下");
    root.unmount();
  });

  test("正文中间输入 @、文件搜索未返回（行空）：Enter 不得把消息发走", () => {
    setup();
    act(() => {
      typeInto(textarea(), "看看@这段", 3);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.ok(
      !sent.some((m) => m.kind === "send"),
      `@ 行空时中途 Enter 不得发送: ${JSON.stringify(sent)}`,
    );
    assert.equal(textarea().value, "看看@这段", "消息不得被发走");
    root.unmount();
  });

  test("接受补全：光标处拼接，正文保留，光标落在插入之后", () => {
    setup();
    // 正文「a zzz」，光标钉在 1，输入 / → 菜单未过滤（query 空），高亮第一行
    act(() => {
      typeInto(textarea(), "a zzz", 1);
    });
    act(() => {
      typeInto(textarea(), "a/ zzz", 2);
    });
    act(() => {
      pressEnter(textarea());
    });
    // 触发段 [1,2) 的「/」被替换为「/new 」（内置命令第一行），正文保留
    assert.equal(textarea().value, "a/new  zzz", "接受应原位拼接，保留前后正文");
    assert.equal(textarea().selectionStart, 6, "光标应落在插入内容之后");
    assert.equal(sent.length, 0, "接受补全不发送");
    root.unmount();
  });

  test("末尾的完整命令：Enter 直接执行命令语法", () => {
    setup();
    act(() => {
      typeInto(textarea(), "/zzz", 4);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.ok(
      sent.some((m) => m.kind === "runCommand" && m.command === "zzz"),
      "末尾命令语法应执行 runCommand",
    );
    assert.equal(textarea().value, "");
    root.unmount();
  });

  test("末尾有高亮项：Enter 接受而非发送", () => {
    setup();
    act(() => {
      typeInto(textarea(), "/rev", 4);
    });
    act(() => {
      pressEnter(textarea());
    });
    assert.equal(sent.length, 0, "有高亮项时 Enter 是接受不是发送");
    assert.equal(textarea().value, "/review ", "应拼接为 /review ");
    root.unmount();
  });
});
