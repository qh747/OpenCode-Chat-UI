import type { AssistantMessage, MessageInfo } from "../opencode/types";

/** Server paths use the worktree's separators; compare them normalized. */
export function diffFileKey(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function serverUserTurns(messages: MessageInfo[]): string[] {
  return messages
    .filter((message) => message.type === "user" && !message.id.startsWith("local-"))
    .map((message) => message.id);
}

/** The message-id range `GET /api/session/{id}/diff` needs. */
export interface DiffRange {
  from?: string;
  to?: string;
}

/**
 * The range `GET /api/session/{id}/diff` needs to describe the whole session.
 *
 * Without `from`/`to` the server diffs only the turn of the newest user
 * message, so a follow-up "thanks" turn (or any turn without edits) emptied
 * the changed-files list even though earlier turns had changed files.
 */
export function diffRange(messages: MessageInfo[]): DiffRange {
  const turns = serverUserTurns(messages);
  if (turns.length === 0) {
    return {};
  }
  return { from: turns[0], to: turns[turns.length - 1] };
}

/**
 * The session's attribution set (GLOSSARY): the files this session's turns
 * touched, from each assistant message's snapshot.
 *
 * A range diff is computed over the shared workspace, so another session (or
 * the user) editing the repo between two turns would leak into it. Filtering
 * the result to the files this session actually snapshotted keeps the list
 * session-scoped.
 *
 * Credibility check (server-snapshot-attribution/01, spec 增补 Q21):
 * `snapshot.files` is the shared working tree's content delta inside one
 * message's own snapshot window — not "the files its agent touched". A
 * message that made no tool calls (`tools: []`) cannot have written anything
 * itself, so the files its window framed (another session's turn, the
 * panel's own revert, a manual edit) are foreign, and its claims are
 * skipped. Messages that did call tools keep full attribution: a real write
 * goes through a tool, so no true row is dropped. Known second-order
 * limitation: a tool-using message whose window happens to frame a foreign
 * write still serializes — upgrade to a per-file tool-input cross-check
 * only when observed.
 */
export function attributionSet(messages: MessageInfo[]): Set<string> {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    const assistant = message as AssistantMessage;
    // An absent `tools` field is unknown, not empty: older servers may not
    // send it, and unknown keeps the previous behavior rather than risk
    // dropping real writes (the rule must stay zero-false-negative).
    if (assistant.tools !== undefined && assistant.tools.length === 0) {
      continue;
    }
    for (const file of assistant.snapshot?.files ?? []) {
      files.add(diffFileKey(file));
    }
  }
  return files;
}
