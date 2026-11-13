import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
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

test("logs output lines for diagnostics", async () => {
  const { manager, logs } = makeManager({
    commandSpec: (port) => ({ command: process.execPath, args: [mockServer, String(port)] }),
  });
  await manager.start();
  assert.ok(logs.some((line) => line.includes("spawn attempt")), logs.join("\n"));
  await manager.dispose();
});
