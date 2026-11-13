import type {
  AgentInfo,
  AssistantMessage,
  FileDiffInfo,
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
} from "./types";

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

/** Append ?directory=… (URL-encoded) when a directory is provided. */
function withDirectory(path: string, directory?: string): string {
  if (!directory) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}directory=${encodeURIComponent(directory)}`;
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
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: this.auth,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
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

  async createSession(body: {
    title?: string;
    agent?: string;
    model?: ModelRef;
    location?: { directory: string };
  }): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>("POST", "/api/session", body);
  }

  async getSession(id: string): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>("GET", `/api/session/${encodeURIComponent(id)}`);
  }

  async patchSession(
    id: string,
    body: { title?: string | null; archived?: boolean },
  ): Promise<{ data: SessionInfo }> {
    return this.request<{ data: SessionInfo }>(
      "PATCH",
      `/api/session/${encodeURIComponent(id)}`,
      body,
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.request<void>("DELETE", `/api/session/${encodeURIComponent(id)}`);
  }

  async listMessages(id: string): Promise<ListPage<MessageInfo>> {
    return this.request<ListPage<MessageInfo>>(
      "GET",
      `/api/session/${encodeURIComponent(id)}/message`,
    );
  }

  /** Send a user message; the reply streams back over /api/event. */
  async prompt(
    id: string,
    body: { text: string; files?: PromptFileAttachment[] },
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(id)}/prompt`,
      body,
    );
  }

  async interrupt(id: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(id)}/interrupt`,
      {},
    );
  }

  async setAgent(id: string, agent: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(id)}/agent`,
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
      `/api/session/${encodeURIComponent(id)}/model`,
      { model: ref },
    );
  }

  /** Fork (copy) a session; returns the new session. */
  async forkSession(id: string): Promise<SessionInfo> {
    const result = await this.request<{ data: SessionInfo }>(
      "POST",
      `/api/session/${encodeURIComponent(id)}/fork`,
    );
    return result.data;
  }

  /**
   * Catalog endpoints are location-scoped since opencode 2.3.0: without a
   * `directory` query the server returns empty lists (verified live), so every
   * caller passes the workspace directory.
   */
  async agents(directory?: string): Promise<{ data: AgentInfo[] }> {
    return this.request<{ data: AgentInfo[] }>("GET", withDirectory("/api/agent", directory));
  }

  async providers(directory?: string): Promise<{ data: ProviderInfo[] }> {
    return this.request<{ data: ProviderInfo[] }>("GET", withDirectory("/api/provider", directory));
  }

  async models(directory?: string): Promise<{ data: ModelInfo[] }> {
    return this.request<{ data: ModelInfo[] }>("GET", withDirectory("/api/model", directory));
  }

  async defaultModel(directory?: string): Promise<ModelRef | undefined> {
    const payload = await this.request<unknown>("GET", withDirectory("/api/model/default", directory));
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
      withDirectory("/api/permission/request", directory),
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
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      { decision },
    );
  }

  /** File diffs produced by the session so far. */
  async sessionDiff(id: string): Promise<{ data: FileDiffInfo[] }> {
    return this.request<{ data: FileDiffInfo[] }>(
      "GET",
      `/api/session/${encodeURIComponent(id)}/diff`,
    );
  }

  /** Assistant message lookup (for reading the snapshot of a finished turn). */
  async assistantMessage(sessionID: string, messageID: string): Promise<AssistantMessage> {
    return this.request<AssistantMessage>(
      "GET",
      `/api/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(messageID)}`,
    );
  }

  /** Stage a revert of everything after the given message (call commit after). */
  async revertStage(
    sessionID: string,
    messageID: string,
  ): Promise<{ data: { messageID: string; files?: FileDiffInfo[] } }> {
    return this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/revert/stage`,
      { messageID },
    );
  }

  /** Commit the previously staged revert (rolls back files and messages). */
  async revertCommit(sessionID: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/revert/commit`,
      {},
    );
  }
}
