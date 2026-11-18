import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { OpencodeEventStream } from "../src/opencode/events";
import type { OEvent } from "../src/opencode/types";

/**
 * 目录过滤的放宽规则(spec 工票 02,ADR-0014):事件信封的
 * `location.directory` 等于工作区才放行,宿主谓词可额外放行本仓的
 * worktree——worktree 的 `vcs.branch.updated` 信号与被搬移会话的
 * `session.*` 事件都靠这条缝进入面板。无 location 的事件维持放行。
 */

/** 用 stub fetch 驱动真实 SSE 泵:每个 SSE 行作为一个 chunk。 */
function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
}

interface Delivered {
  type: string;
  directory?: string;
}

async function drain(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    // setImmediate 在全部微任务之后运行:一轮即让泵把已入队的块读完。
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function drive(lines: string[], acceptsDirectory?: (directory: string) => boolean) {
  const delivered: Delivered[] = [];
  const states: string[] = [];
  const originalFetch = globalThis.fetch;
  const stream = new OpencodeEventStream({
    baseUrl: "http://test",
    password: "pw",
    directory: "/repo",
    acceptsDirectory,
    onEvent: (event: OEvent) =>
      delivered.push({
        type: event.type,
        directory: event.location?.directory,
      }),
    onState: (state) => states.push(state),
  });
  return {
    run: async () => {
      globalThis.fetch = (async () =>
        ({ ok: true, body: sseBody(lines) }) as unknown as Response) as typeof fetch;
      try {
        stream.start();
        await drain();
      } finally {
        stream.stop(); // 清掉重连定时器;closed 随之而来
        globalThis.fetch = originalFetch; // stub 绝不能泄漏给其他测试
        await drain();
      }
      return { delivered, states };
    },
  };
}

function eventLine(type: string, directory?: string): string {
  const payload: OEvent = {
    id: `evt_${type}`,
    type,
    created: 0,
    ...(directory ? { location: { directory } } : {}),
    data: { branch: "ticket/x" },
  };
  return `data: ${JSON.stringify(payload)}`;
}

describe("event stream directory filter", () => {
  test("workspace and locationless events pass, foreign directories drop", async () => {
    const { run } = drive([
      eventLine("vcs.branch.updated", "/repo"),
      eventLine("vcs.branch.updated", "/somewhere/else"),
      eventLine("server.connected"),
    ]);
    const { delivered, states } = await run();
    assert.deepEqual(
      delivered.map((d) => d.directory),
      ["/repo", undefined],
    );
    // 流读完即"可重连"(事件流易失性),stop() 再补 closed。
    assert.deepEqual(states, ["open", "reconnecting", "closed"]);
  });

  test("the host predicate admits this repository's worktrees only", async () => {
    const { run } = drive(
      [
        eventLine("vcs.branch.updated", "/repo/.opencode/wt"),
        eventLine("vcs.branch.updated", "/unrelated/wt"),
      ],
      (directory) => directory === "/repo/.opencode/wt",
    );
    const { delivered } = await run();
    assert.deepEqual(
      delivered.map((d) => d.directory),
      ["/repo/.opencode/wt"],
    );
  });
});
