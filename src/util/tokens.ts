import type { AssistantMessage, MessageInfo, TokenUsage } from "../opencode/types";

/** Sum of every token bucket reported by the server. */
export function totalTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/**
 * The latest assistant message carrying usage, which is where both context
 * occupancy and cache-hit-rate readouts come from.
 *
 * Mirrors the official opencode web UI's `lastAssistantWithUsage` helper:
 * stop at the revert point when one is set, ignore everything up to and
 * including the latest completed compaction (it rebuilt the context), and
 * skip assistant messages that have not reported tokens yet.
 *
 * `messages` must be in chronological (oldest-first) order — the output of
 * `orderMessages`.
 */
export function lastBilledAssistant(
  messages: MessageInfo[],
  revertMessageID?: string,
): AssistantMessage | undefined {
  let end = messages.length;
  if (revertMessageID !== undefined) {
    const revertIndex = messages.findIndex((message) => message.id === revertMessageID);
    // Unknown revert point: the official UI bails out entirely.
    if (revertIndex === -1) {
      return undefined;
    }
    end = revertIndex;
  }
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    const message = messages[i] as { type?: string; status?: string };
    if (message.type === "compaction" && message.status === "completed") {
      start = i;
      break;
    }
  }
  for (let i = end - 1; i > start; i--) {
    const assistant = messages[i] as AssistantMessage;
    if (assistant.type === "assistant" && assistant.tokens !== undefined) {
      return assistant;
    }
  }
  return undefined;
}

/**
 * Context-window occupancy for the gauge: the token totals of the latest
 * billed assistant message, not the cumulative session counters (which grow
 * with every turn and mean nothing against the context limit).
 */
export function contextTokensOf(
  messages: MessageInfo[],
  revertMessageID?: string,
): number | undefined {
  const tokens = lastBilledAssistant(messages, revertMessageID)?.tokens;
  return tokens ? totalTokens(tokens) : undefined;
}

/**
 * Cache hit rate of one usage record: the share of prompt tokens served from
 * cache. `input` counts only the non-hit prompt tokens (plus the asking
 * tokens some providers fold in), so the denominator is input + cache.read.
 */
export function cacheHitRate(tokens: TokenUsage): number | undefined {
  const prompt = tokens.input + tokens.cache.read;
  if (prompt <= 0) {
    return undefined;
  }
  return tokens.cache.read / prompt;
}

/** Cache hit rate of the same message the context gauge reads. */
export function cacheHitRateOf(
  messages: MessageInfo[],
  revertMessageID?: string,
): number | undefined {
  const tokens = lastBilledAssistant(messages, revertMessageID)?.tokens;
  return tokens ? cacheHitRate(tokens) : undefined;
}
