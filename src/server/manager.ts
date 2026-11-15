import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import * as net from "node:net";
import { resolveBinary } from "./resolve";

export type ServerState = "stopped" | "starting" | "connected" | "error";

export interface ActiveServer {
  url: string;
  password: string;
  version: string;
  /** Whether the server process is owned by this window (spawned). */
  owned: boolean;
}

export interface ServerManagerOptions {
  /** Workspace directory the server should operate on. */
  directory: string;
  settings: {
    path: string;
    serverUrl: string;
    serverPassword: string;
  };
  logger: (line: string) => void;
  onState: (state: ServerState, detail?: string) => void;
  /** Test seam: override how the server process command is built. */
  commandSpec?: (port: number) => { command: string; args: string[] };
  spawnImpl?: typeof spawn;
  healthTimeoutMs?: number;
}

const LOG_RING_LIMIT = 200;

/**
 * Ports the Fetch spec declares unsafe, so undici rejects them before opening a
 * socket with the opaque `fetch failed` / `bad port` error. Windows hands out
 * ephemeral ports from 1024 by default, which includes IRC 6665-6669 and X11
 * 6000 — a random internal-server port can land there. Keep them out of the
 * pool instead of diagnosing the resulting "all requests fail" later.
 */
const FETCH_BLOCKED_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

/** Startup failure that retrying cannot fix (e.g. the binary is opencode v1). */
class FatalStartError extends Error {}

/**
 * Owns the opencode server lifecycle for one VS Code window: either spawns a
 * private `opencode serve` (random port + random basic-auth password, killed
 * with the window) or verifies the user-configured external server.
 */
export class ServerManager {
  private child: ChildProcess | undefined;
  private server: ActiveServer | undefined;
  private disposed = false;
  private readonly logRing: string[] = [];
  private state: ServerState = "stopped";

  constructor(private readonly options: ServerManagerOptions) {}

  get active(): ActiveServer | undefined {
    return this.server;
  }

  private setState(state: ServerState, detail?: string): void {
    this.state = state;
    this.options.onState(state, detail);
  }

  private log(line: string): void {
    const stamped = `${new Date().toISOString()} ${line}`;
    this.logRing.push(stamped);
    if (this.logRing.length > LOG_RING_LIMIT) {
      this.logRing.shift();
    }
    this.options.logger(stamped);
  }

  logTail(lines = 30): string {
    return this.logRing.slice(-lines).join("\n");
  }

  get currentState(): ServerState {
    return this.state;
  }

  async start(): Promise<ActiveServer> {
    if (this.disposed) {
      throw new Error("ServerManager already disposed");
    }
    if (this.server) {
      return this.server;
    }
    const { serverUrl } = this.options.settings;
    if (serverUrl.trim()) {
      return this.connectExternal(serverUrl.trim());
    }
    return this.spawnInternal();
  }

  private async connectExternal(url: string): Promise<ActiveServer> {
    this.setState("starting");
    let port: number;
    try {
      const parsed = new URL(url);
      port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    } catch (error) {
      const detail = `invalid opencode.serverUrl: ${message(error)}`;
      this.log(detail);
      this.setState("error", detail);
      throw new Error(detail);
    }
    if (isFetchBlockedPort(port)) {
      const detail =
        `port ${port} is blocked by Node's Fetch implementation; ` +
        `use a different port in "opencode.serverUrl".`;
      this.log(detail);
      this.setState("error", detail);
      throw new Error(detail);
    }
    const password = this.options.settings.serverPassword;
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const infoUrl = `${url.replace(/\/+$/, "")}/api/info`;
    try {
      const response = await fetch(infoUrl, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${infoUrl}`);
      }
      const info = (await response.json()) as { version?: string };
      this.server = { url: infoUrl.replace(/\/api\/info$/, ""), password, version: info.version ?? "unknown", owned: false };
      this.log(`connected to external server ${this.server.url} (v${this.server.version})`);
      this.setState("connected");
      return this.server;
    } catch (error) {
      const detail = `failed to reach opencode server at ${url}: ${message(error)}`;
      this.log(detail);
      this.setState("error", detail);
      throw new Error(detail);
    }
  }

  private async spawnInternal(): Promise<ActiveServer> {
    const resolved = await resolveBinary(this.options.settings.path, (line) => this.log(line));
    if (!resolved) {
      const detail =
        "opencode CLI not found. Install it (https://opencode.ai/docs) or set \"opencode.path\".";
      this.log(detail);
      this.setState("error", detail);
      throw new Error(detail);
    }
    this.log(`using opencode binary: ${resolved.path} (${resolved.source})`);
    this.setState("starting");

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.disposed) {
        throw new Error("disposed");
      }
      const port = await pickFreePort();
      const password = randomBytes(24).toString("base64url");
      const spec =
        this.options.commandSpec?.(port) ??
        {
          command: resolved.path,
          args: ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
        };
      this.log(`spawn attempt ${attempt + 1}: ${spec.command} ${spec.args.join(" ")}`);
      // Strip Electron/Node runtime pollution the VS Code host injects —
      // child processes must start from a clean runtime environment.
      const {
        ELECTRON_RUN_AS_NODE: _e,
        NODE_OPTIONS: _n,
        ELECTRON_NO_ATTACH_CONSOLE: _c,
        ELECTRON_FIRST_LOAD: _f,
        ...cleanEnv
      } = process.env;
      const env: NodeJS.ProcessEnv = {
        ...cleanEnv,
        OPENCODE_PASSWORD: password,
        OPENCODE_SERVER_PASSWORD: password,
      };
      const spawnImpl = this.options.spawnImpl ?? spawn;
      // Node ≥20.12 refuses to spawn .cmd/.bat without a shell (CVE-2024-27980).
      const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.command);
      this.child = spawnImpl(spec.command, spec.args, {
        cwd: this.options.directory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: needsShell,
      });
      this.child.stdout?.on("data", (chunk: Buffer) => this.log(chunk.toString()));
      this.child.stderr?.on("data", (chunk: Buffer) => this.log(chunk.toString()));
      const exitInfo = this.watchExit();
      let started: string | undefined;
      try {
        started = await this.waitHealthy(port, password);
      } catch (error) {
        if (error instanceof FatalStartError) {
          // Retrying cannot fix a wrong major version — fail fast and clean up.
          await this.killChild();
          this.log(`fatal: ${error.message}`);
          this.setState("error", error.message);
          throw error;
        }
        started = undefined;
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (started) {
        this.server = { url: `http://127.0.0.1:${port}`, password, version: started, owned: true };
        this.setState("connected");
        return this.server;
      }
      if (!lastError) {
        lastError = exitInfo.reason ?? `server did not become healthy on port ${port}`;
      }
      this.log(`attempt ${attempt + 1} failed: ${lastError}`);
      await this.killChild();
    }
    const detail = `could not start opencode server: ${lastError}. Run "OpenCode: Show Logs" for details.`;
    this.setState("error", detail);
    throw new Error(detail);
  }

  private exitHandler: ((reason: string) => void) | undefined;

  /** Resolves with the exit reason if the child dies during startup wait. */
  private watchExit(): { get reason(): string | undefined } {
    const child = this.child;
    if (!child) {
      return { get reason() { return undefined; } };
    }
    let reason: string | undefined;
    const onExit = (code: number | null, signal: string | null) => {
      reason = `process exited (code=${code ?? "null"} signal=${signal ?? "null"})`;
      this.exitHandler?.(reason);
    };
    const onError = (error: Error) => {
      reason = `spawn failed: ${error.message}`;
      this.exitHandler?.(reason);
    };
    child.once("exit", onExit);
    child.once("error", onError);
    return {
      get reason() {
        return reason;
      },
    };
  }

  private async waitHealthy(port: number, password: string): Promise<string | undefined> {
    const timeoutMs = this.options.healthTimeoutMs ?? 30_000;
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const deadline = Date.now() + timeoutMs;
    let exitReason: string | undefined;
    this.exitHandler = (reason) => { exitReason = reason; };
    while (Date.now() < deadline) {
      if (this.disposed) {
        throw new Error("disposed");
      }
      if (exitReason) {
        this.exitHandler = undefined;
        throw new Error(`opencode serve exited during startup: ${exitReason}`);
      }
      // node:http instead of fetch: VS Code may configure a global proxy
      // dispatcher for fetch, which cannot reach our loopback server.
      try {
        const result = await httpGetJson(`http://127.0.0.1:${port}/api/info`, auth, 1_500);
        if (result.status === 200) {
          const info = JSON.parse(result.body) as { version?: string };
          this.exitHandler = undefined;
          return info.version ?? "unknown";
        }
      } catch {
        // not up yet; keep polling
      }
      // No /api/info? Maybe an opencode v1 server (health at /global/health).
      try {
        const legacy = await httpGetJson(`http://127.0.0.1:${port}/global/health`, auth, 1_500);
        if (legacy.status === 200) {
          const info = JSON.parse(legacy.body) as { healthy?: boolean; version?: string };
          const major = Number.parseInt(info.version ?? "", 10);
          this.exitHandler = undefined;
          if (major === 1) {
            throw new FatalStartError(
              `opencode v1 server detected (v${info.version}). This extension requires opencode v2 — run \`opencode upgrade\` (or reinstall from https://opencode.ai/docs) and reload the window.`,
            );
          }
          return info.version ?? "unknown";
        }
      } catch (error) {
        if (error instanceof FatalStartError) {
          throw error;
        }
        // still not up; keep polling
      }
      await delay(250);
    }
    this.exitHandler = undefined;
    return undefined;
  }

  async restart(): Promise<ActiveServer> {
    await this.dispose();
    return this.start();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.server = undefined;
    await this.killChild();
    this.setState("stopped");
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

export function message(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause instanceof Error
    ? `${error.message} (${error.cause.message})`
    : error.message;
}

/** Ask the OS for an ephemeral port. */
function pickOsPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Loop until the OS hands out a port the Fetch stack accepts. `allocate` is a
 * test seam; production callers omit it.
 */
export async function pickFreePort(
  allocate: () => Promise<number> = pickOsPort,
): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await allocate();
    if (!isFetchBlockedPort(port)) {
      return port;
    }
  }
  throw new Error("could not find a port that Node's fetch will connect to");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Plain loopback HTTP GET that bypasses any global fetch proxy dispatcher. */
function httpGetJson(
  url: string,
  auth: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { headers: { Authorization: auth }, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("health check timeout")));
    req.on("error", reject);
    req.end();
  });
}
