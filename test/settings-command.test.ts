import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type * as vscode from "vscode";
import { activate } from "../src/extension";
import { commands, executedCommands, resetCommands } from "./vscode-stub";

/**
 * `opencode.openSettings` 打开原生设置页并按扩展 ID 过滤。ID 一旦写死就会在
 * publisher/name 改名后失配，设置页只剩“未找到设置”。这里从 package.json 推导
 * VS Code 实际使用的扩展 ID，再断言命令传给 workbench 的过滤串与之相符。
 */
describe("OpenCode: Settings command", () => {
  test("filters the native settings page with this extension's real id", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      publisher: string;
      name: string;
    };
    const extensionId = `${pkg.publisher}.${pkg.name}`;

    resetCommands();
    const context = {
      subscriptions: [] as Array<{ dispose(): void }>,
      extension: { id: extensionId },
      extensionUri: { fsPath: "" },
    };
    activate(context as unknown as vscode.ExtensionContext);

    await commands.executeCommand("opencode.openSettings");

    assert.deepEqual(executedCommands, [
      { command: "workbench.action.openSettings", args: [`@ext:${extensionId}`] },
    ]);
  });
});
