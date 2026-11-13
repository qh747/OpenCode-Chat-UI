import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
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
    this.logRing.push(line);
    if (this.logRing.length > LOG_RING_LIMIT) {
      this.logRing.shift();
    }
    this.options.logger(line);
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
    const resolved = await resolveBinary(this.options.settings.path);
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
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCODE_PASSWORD: password,
        OPENCODE_SERVER_PASSWORD: password,
      };
      const spawnImpl = this.options.spawnImpl ?? spawn;
      this.child = spawnImpl(spec.command, spec.args, {
        cwd: this.options.directory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child.stdout?.on("data", (chunk: Buffer) => this.log(chunk.toString()));
      this.child.stderr?.on("data", (chunk: Buffer) => this.log(chunk.toString()));
      const exitInfo = this.watchExit();
      let started: string | undefined;
      try {
        started = await this.waitHealthy(port, password);
      } catch (error) {
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
    const url = `http://127.0.0.1:${port}/api/info`;
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
      try {
        const response = await fetch(url, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(1_500),
        });
        if (response.ok) {
          const info = (await response.json()) as { version?: string };
          this.exitHandler = undefined;
          return info.version ?? "unknown";
        }
      } catch {
        // not up yet; keep polling
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
  return error instanceof Error ? error.message : String(error);
}

async function pickFreePort(): Promise<number> {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
