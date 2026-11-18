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
 */
export function attributionSet(messages: MessageInfo[]): Set<string> {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.type !== "assistant") {
      continue;
    }
    for (const file of (message as AssistantMessage).snapshot?.files ?? []) {
      files.add(diffFileKey(file));
    }
  }
  return files;
}
