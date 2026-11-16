import type {
  AgentInfo,
  AssistantMessage,
  CommandInfo,
  FileDiffInfo,
  FormAnswerValue,
  FormInfo,
  JobInfo,
  ListPage,
  MessageInfo,
  ModelInfo,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  PromptFileAttachment,
  ProviderInfo,
  ServerInfo,
  SessionInfo,
  SkillInfo,
} from "./types";
import { locationQuery } from "../util/catalog-params";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`opencode API ${status} on ${url}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

/** Keep the underlying network cause; bare "fetch failed" hides bad-port/proxy issues. */
function requestError(url: string, error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`opencode request failed: ${url} — ${String(error)}`);
  }
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return new Error(`opencode request failed: ${url} — ${error.message}${cause}`, {
    cause: error,
  });
}

/**
 * Every session-scoped route funnels through here. An empty id used to build
 * `/api/session//model` (and friends), which the server answers with a 404 that
 * looked like a feature bug; fail loudly at the boundary instead.
 */
function sessionPath(id: string, suffix = ""): string {
  if (!id.trim()) {
    throw new Error("opencode: a session id is required");
  }
  return `/api/session/${encodeURIComponent(id)}${suffix}`;
}

/** Append the deepObject location query when a directory is provided. */
function withLocation(path: string, directory?: string): string {
  if (!directory) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${locationQuery(directory)}`;
}

export interface ClientOptions {
  baseUrl: string;
  /** Password for HTTP basic auth. Username is always "opencode". */
  password: string;
  /** Total request timeout in ms. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin typed client for the opencode v2 HTTP API, verified against the
 * server's own OpenAPI document (`GET /openapi.json` on v2.2.7). Deliberately
 * dependency-free: everything this extension needs is a handful of endpoints
 * plus one SSE stream, and the official client package was still churning
 * when this was written.
 */
export class OpencodeClient {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.auth = `Basic ${Buffer.from(`opencode:${options.password}`).toString("base64")}`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.auth,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw requestError(url, error);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiError(response.status, url, text);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, url, `invalid JSON: ${text.slice(0, 100)}`);
    }
  }

  async info(): Promise<ServerInfo> {
    return this.request<ServerInfo>("GET", "/api/info");
  }

  async listSessions(query: {
    directory?: string;
    limit?: number;
    order?: "asc" | "desc";
    archived?: boolean;
    search?: string;
    cursor?: string;
  }): Promise<ListPage<SessionInfo>> {
    const params = new URLSearchParams();
    if (query.directory) {
      params.set("directory", query.directory);
    }
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query.order) {
      params.set("order", query.order);
    }
    if (query.archived !== undefined) {
      params.set("archived", String(query.archived));
    }
    if (query.search) {
      params.set("search", query.search);
    }
    if (query.cursor) {
      params.set("cursor", query.cursor);
    }
    const qs = params.toString();
    return this.request<ListPage<SessionInfo>>("GET", `/api/session${qs ? `?${qs}` : ""}`);
  }

  /** Sessions currently running on this server; absent means inactive. */
  async activeSessions(): Promise<{ data: Record<string, { type?: string }> }> {
    return this.request<{ data: Record<string, { type?: string }> }>("GET", "/api/session/active");
  }

  async createSession(body: {
    title?: string;
    agent?: string;
    model?: ModelRef;
    location?: { directory: string };
  }): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>("POST", "/api/session", body);
  }

  async getSession(id: string): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>("GET", sessionPath(id));
  }

  async patchSession(
    id: string,
    body: { title?: string | null; archived?: boolean },
  ): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>(
      "PATCH",
      sessionPath(id),
      body,
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.request<void>("DELETE", sessionPath(id));
  }

  async listMessages(id: string): Promise<ListPage<MessageInfo>> {
    return this.request<ListPage<MessageInfo>>(
      "GET",
      sessionPath(id, "/message"),
    );
  }

  /** Send a user message; the reply streams back over /api/event. */
  async prompt(
    id: string,
    body: { text: string; files?: PromptFileAttachment[] },
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(id, "/prompt"),
      body,
    );
  }

  async interrupt(id: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(id, "/interrupt"),
      {},
    );
  }

  /**
   * Background jobs owned by this session and its child sessions. Subagents
   * appear here while a `task` tool call runs; the endpoint has no events, so
   * callers poll it. Verified live on 2.3.0.
   */
  async jobs(sessionID: string): Promise<{ data: JobInfo[] }> {
    // 走 sessionPath 只为复用同一处空 id 校验，避免空 id 静默返回空列表
    sessionPath(sessionID);
    const query = new URLSearchParams({ sessionID, descendants: "true" });
    return this.request<{ data: JobInfo[] }>("GET", `/api/experimental/job?${query.toString()}`);
  }

  async setAgent(id: string, agent: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(id, "/agent"),
      { agent },
    );
  }

  async setModel(id: string, model: ModelRef): Promise<void> {
    const ref: Record<string, string> = { providerID: model.providerID, id: model.id };
    if (model.variant) {
      ref.variant = model.variant;
    }
    await this.request<unknown>(
      "POST",
      sessionPath(id, "/model"),
      { model: ref },
    );
  }

  /** Fork (copy) a session; returns the new session. */
  async forkSession(id: string): Promise<SessionInfo> {
    const result = await this.request<{ data: SessionInfo }>(
      "POST",
      sessionPath(id, "/fork"),
    );
    return result.data;
  }

  /**
   * Catalog endpoints are location-scoped since opencode 2.3.0 and require
   * the deepObject query `?location[directory]=…` (verified live: the plain
   * `?directory=` form returns empty lists).
   */
  async agents(directory?: string): Promise<{ data: AgentInfo[] }> {
    return this.request<{ data: AgentInfo[] }>("GET", withLocation("/api/agent", directory));
  }

  async providers(directory?: string): Promise<{ data: ProviderInfo[] }> {
    return this.request<{ data: ProviderInfo[] }>("GET", withLocation("/api/provider", directory));
  }

  async models(directory?: string): Promise<{ data: ModelInfo[] }> {
    return this.request<{ data: ModelInfo[] }>("GET", withLocation("/api/model", directory));
  }

  async defaultModel(directory?: string): Promise<ModelRef | undefined> {
    const payload = await this.request<unknown>("GET", withLocation("/api/model/default", directory));
    const ref = (payload as { data?: ModelRef }).data ?? (payload as ModelRef);
    if (ref && typeof ref === "object" && "providerID" in ref && "id" in ref) {
      return ref as ModelRef;
    }
    return undefined;
  }

  /** Pending permission requests across the server. */
  async pendingPermissions(directory?: string): Promise<{ data: PermissionRequest[] }> {
    return this.request<{ data: PermissionRequest[] }>(
      "GET",
      withLocation("/api/permission/request", directory),
    );
  }

  /**
   * Slash commands for the current location. Verified live on 2.3.0: called
   * without parameters this returns the commands for the server's default
   * location (the extension spawns the server with the workspace as cwd);
   * passing a `directory` query unexpectedly returns an empty list.
   */
  async commands(): Promise<{ data: CommandInfo[] }> {
    return this.request<{ data: CommandInfo[] }>("GET", "/api/command");
  }

  /** Skills for the current location. */
  async skills(): Promise<{ data: SkillInfo[] }> {
    return this.request<{ data: SkillInfo[] }>("GET", "/api/skill");
  }

  /**
   * The shells the server can run commands with. The response shape is not
   * pinned down by the OpenAPI document, so the entries are handed back
   * untyped and mapped defensively by the caller.
   */
  async shells(): Promise<unknown[]> {
    const payload = await this.request<unknown>("GET", "/api/config/shell");
    if (Array.isArray(payload)) {
      return payload;
    }
    const data = (payload as { data?: unknown[] } | undefined)?.data;
    return Array.isArray(data) ? data : [];
  }

  /**
   * Write the server's `shell` key. This is the one config key the server
   * accepts over HTTP (`PATCH /api/experimental/config`); every other key has
   * to be written into the config file directly.
   */
  async updateShell(shell: string | null): Promise<void> {
    await this.request<void>("PATCH", "/api/experimental/config", { shell });
  }

  /** Execute a slash command within a session. */
  async runCommand(sessionID: string, name: string, text: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(sessionID, "/command"),
      { name, text },
    );
  }

  /** Summarize the session to reduce context size (/compact). */
  async compact(sessionID: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(sessionID, "/compact"),
      {},
    );
  }

  /** Reply to a permission request. */
  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: PermissionDecision,
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(sessionID, `/permission/${encodeURIComponent(requestID)}/reply`),
      { decision },
    );
  }

  /** Pending forms for a session (the `question` tool blocks on one). */
  async sessionForms(sessionID: string): Promise<{ data: FormInfo[] }> {
    return this.request<{ data: FormInfo[] }>("GET", sessionPath(sessionID, "/form"));
  }

  /**
   * Answer a pending form. A string field answers with a plain string,
   * a multiselect field with an array of strings (verified live on v2.3.0 —
   * an array for a string field is rejected with FormInvalidAnswerError).
   */
  async replyForm(
    sessionID: string,
    formID: string,
    answer: Record<string, FormAnswerValue>,
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(sessionID, `/form/${encodeURIComponent(formID)}/reply`),
      { answer },
    );
  }

  /** Cancel a pending form, optionally telling the asker why it went unanswered. */
  async cancelForm(sessionID: string, formID: string, message?: string): Promise<void> {
    const suffix = message !== undefined ? `?message=${encodeURIComponent(message)}` : "";
    await this.request<unknown>(
      "DELETE",
      sessionPath(sessionID, `/form/${encodeURIComponent(formID)}${suffix}`),
    );
  }

  /** File diffs produced by the session so far. */
  async sessionDiff(id: string): Promise<{ data: FileDiffInfo[] }> {
    return this.request<{ data: FileDiffInfo[] }>(
      "GET",
      sessionPath(id, "/diff"),
    );
  }

  /** Assistant message lookup (for reading the snapshot of a finished turn). */
  async assistantMessage(sessionID: string, messageID: string): Promise<AssistantMessage> {
    return this.request<AssistantMessage>(
      "GET",
      sessionPath(sessionID, `/message/${encodeURIComponent(messageID)}`),
    );
  }

  /** Stage a revert of everything after the given message (call commit after). */
  async revertStage(
    sessionID: string,
    messageID: string,
  ): Promise<{ data: { messageID: string; files?: FileDiffInfo[] } }> {
    return this.request(
      "POST",
      sessionPath(sessionID, "/revert/stage"),
      { messageID },
    );
  }

  /** Commit the previously staged revert (rolls back files and messages). */
  async revertCommit(sessionID: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      sessionPath(sessionID, "/revert/commit"),
      {},
    );
  }
}
