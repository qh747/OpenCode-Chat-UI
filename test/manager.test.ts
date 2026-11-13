import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";
import { ServerManager } from "../src/server/manager";

// Tests are bundled to out/tests.cjs by esbuild, so __dirname is out/ —
// resolve the mock script from the repo root instead.
const mockServer = path.join(process.cwd(), "test", "mock-server.mjs");

function makeManager(overrides: Partial<ConstructorParameters<typeof ServerManager>[0]> = {}) {
  const logs: string[] = [];
  let state = "";
  const manager = new ServerManager({
    directory: process.cwd(),
    settings: { path: "", serverUrl: "", serverPassword: "" },
    logger: (line) => logs.push(line),
    onState: (next) => {
      state = next;
    },
    healthTimeoutMs: 10_000,
    ...overrides,
  });
  return { manager, logs, getState: () => state };
}

test("spawns a server, health-checks it and disposes the process", async () => {
  const { manager, getState } = makeManager({
    commandSpec: (port) => ({ command: process.execPath, args: [mockServer, String(port)] }),
  });
  const active = await manager.start();
  assert.equal(manager.currentState, "connected");
  assert.equal(active.version, "mock-1.0.0");
  assert.match(active.url, /127\.0\.0\.1:\d+/);
  assert.equal(active.owned, true);

  await manager.dispose();
  assert.equal(getState(), "stopped");
});

test("connects to an external server URL without spawning", async () => {
  const spawned = makeManager({
    commandSpec: (port) => ({ command: process.execPath, args: [mockServer, String(port)] }),
  });
  const reference = await spawned.manager.start(); // keep running as the "external" server

  const external = makeManager({
    settings: { path: "", serverUrl: reference.url, serverPassword: "" },
  });
  const active = await external.manager.start();
  assert.equal(active.owned, false);
  assert.equal(active.version, "mock-1.0.0");
  assert.equal(external.getState(), "connected");
  await external.manager.dispose();
  await spawned.manager.dispose();
});

test("fails with a helpful error when the command dies immediately", async () => {
  const { manager } = makeManager({
    commandSpec: () => ({ command: process.execPath, args: ["--this-flag-does-not-exist"] }),
    healthTimeoutMs: 3_000,
  });
  await assert.rejects(() => manager.start(), /could not start opencode server/);
  assert.equal(manager.currentState, "error");
  await manager.dispose();
});

test("rejects an opencode v1 server with upgrade guidance (fail fast, no retries)", async () => {
  const { manager, logs } = makeManager({
    commandSpec: (port) => ({
      command: process.execPath,
      args: [mockServer, String(port), "--v1"],
    }),
    healthTimeoutMs: 10_000,
  });
  const started = Date.now();
  await assert.rejects(() => manager.start(), /requires opencode v2/);
  assert.equal(manager.currentState, "error");
  assert.ok(Date.now() - started < 5_000, "v1 detection must fail fast, not exhaust retries");
  assert.equal(
    logs.filter((line) => line.includes("spawn attempt")).length,
    1,
    "retrying a v1 binary is pointless",
  );
  await manager.dispose();
});

test("logs output lines for diagnostics", async () => {
  const { manager, logs } = makeManager({
    commandSpec: (port) => ({ command: process.execPath, args: [mockServer, String(port)] }),
  });
  await manager.start();
  assert.ok(logs.some((line) => line.includes("spawn attempt")), logs.join("\n"));
  await manager.dispose();
});

test("spawns .cmd shims through a shell on Windows (Node CVE-2024-27980 guard)", async () => {
  let capturedShell: boolean | undefined;
  let capturedCommand = "";
  const { manager } = makeManager({
    commandSpec: (port) => ({ command: "C:\\fake\\opencode.cmd", args: ["serve", String(port)] }),
    spawnImpl: ((command: string, args: readonly string[], options?: SpawnOptions) => {
      capturedCommand = command;
      capturedShell = (options as { shell?: boolean } | undefined)?.shell;
      return spawn(process.execPath, [mockServer, String(args[1] ?? "0")]);
    }) as unknown as typeof spawn,
  });
  await manager.start();
  assert.equal(capturedCommand, "C:\\fake\\opencode.cmd");
  if (process.platform === "win32") {
    assert.equal(capturedShell, true, "expected shell:true for .cmd on Windows");
  }
  assert.equal(manager.currentState, "connected");
  await manager.dispose();
});
