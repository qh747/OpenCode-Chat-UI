import type { OEvent } from "./types";
import { samePath } from "../util/same-path";

export type EventStreamState = "connecting" | "open" | "reconnecting" | "closed";

export interface EventStreamOptions {
  baseUrl: string;
  password: string;
  /** Called for every parsed event. */
  onEvent: (event: OEvent) => void;
  /** Called on connectivity changes (excluding normal close). */
  onState: (state: EventStreamState, error?: Error) => void;
  /** Only deliver events under this directory (when present on the event). */
  directory?: string;
  /**
   * Extra admission for events from other directories — the host passes its
   * "is this one of the workspace's worktrees" rule here (ADR-0014), so
   * branch updates and moved sessions working inside a worktree still reach
   * the panel. Only consulted for events that failed the `directory` match.
   */
  acceptsDirectory?: (directory: string) => boolean;
  /** Reconnect backoff base in ms. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Server-Sent Events consumer for GET /api/event with automatic reconnect.
 *
 * opencode v2 declares the event stream volatile ("slow consumers are
 * disconnected"), so consumers must tolerate gaps: the chat panel refetches
 * authoritative state on reconnect instead of trusting the stream alone.
 */
export class OpencodeEventStream {
  private readonly options: EventStreamOptions;
  private controller: AbortController | undefined;
  private stopped = false;
  private attempt = 0;
  private readonly listeners: AbortListener[] = [];

  constructor(options: EventStreamOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  private addListener(listener: AbortListener): void {
    this.listeners.push(listener);
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    for (const listener of this.listeners.splice(0)) {
      listener();
    }
    this.options.onState("closed");
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.controller = new AbortController();
    const controller = this.controller;
    let failure: Error;
    try {
      const response = await fetch(`${this.options.baseUrl}/api/event`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${this.options.password}`).toString("base64")}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`event stream HTTP ${response.status}`);
      }
      this.attempt = 0;
      this.options.onState("open");
      await this.pump(response.body, controller.signal);
      // Server closed the stream; treat as reconnectable.
      failure = new Error("event stream closed");
    } catch (error) {
      if (controller.signal.aborted) {
        return; // normal stop
      }
      failure = error instanceof Error ? error : new Error(String(error));
    }
    if (this.stopped) {
      return;
    }
    this.attempt += 1;
    const base = this.options.baseBackoffMs ?? 1_000;
    const max = this.options.maxBackoffMs ?? 10_000;
    const delay = Math.min(base * 2 ** (this.attempt - 1), max);
    this.options.onState("reconnecting", failure);
    const timer = setTimeout(() => void this.connect(), delay);
    this.addListener(() => clearTimeout(timer));
  }

  private async pump(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      if (signal.aborted) {
        reader.releaseLock();
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        this.handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  }

  private handleLine(line: string): void {
    if (!line.startsWith("data:")) {
      return; // heartbeat comments and unknown fields
    }
    const payload = line.slice(5).trim();
    if (!payload) {
      return;
    }
    let event: OEvent;
    try {
      event = JSON.parse(payload) as OEvent;
    } catch {
      return;
    }
    const directory = this.options.directory;
    const eventDirectory = event.location?.directory;
    if (
      directory &&
      eventDirectory &&
      !samePath(eventDirectory, directory) &&
      !this.options.acceptsDirectory?.(eventDirectory)
    ) {
      return;
    }
    this.options.onEvent(event);
  }
}

type AbortListener = () => void;
