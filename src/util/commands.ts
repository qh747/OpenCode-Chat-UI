import type { ModelInfo } from "../opencode/types";

/**
 * Slash-command utilities: filtering the server command list, splitting the
 * typed input and deciding whether a command runs client-side or on the
 * server. The v2 `/api/command` endpoint only lists server/config commands —
 * the built-in client commands below are handled by the extension itself.
 */

export interface CommandInfoLike {
  name: string;
  description?: string;
}

export type ClientCommandAction = {
  kind: "client";
  action: "new" | "undo" | "export" | "fork" | "compact";
};

export type CommandAction = ClientCommandAction | { kind: "server" };

const CLIENT_COMMANDS: Record<string, ClientCommandAction> = {
  new: { kind: "client", action: "new" },
  undo: { kind: "client", action: "undo" },
  export: { kind: "client", action: "export" },
  fork: { kind: "client", action: "fork" },
  compact: { kind: "client", action: "compact" },
};

/** Built-in client commands merged into the picker alongside server commands. */
export const BUILTIN_COMMANDS: CommandInfoLike[] = Object.keys(CLIENT_COMMANDS).map((name) => ({
  name,
  description: "",
}));

export function filterCommands(commands: CommandInfoLike[], query: string): CommandInfoLike[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return commands;
  }
  return commands.filter((command) => command.name.toLowerCase().includes(q));
}

export function resolveCommandAction(name: string): CommandAction {
  const normalized = name.replace(/^\//, "").trim().toLowerCase();
  const client = CLIENT_COMMANDS[normalized];
  return client ?? { kind: "server" };
}

export function splitCommandInput(text: string): { command: string; arguments: string } {
  const trimmed = text.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) {
    return { command: trimmed.replace(/^\//, ""), arguments: "" };
  }
  return {
    command: trimmed.slice(0, space).replace(/^\//, ""),
    arguments: trimmed.slice(space + 1).trim(),
  };
}

/**
 * Group models for the picker: Recent first (dedup, most-recent first),
 * then providers in the order opencode-go, opencode, then the rest.
 */
export interface ModelEntry {
  ref: { providerID: string; id: string };
  name: string;
  providerName: string;
}

export function providerDisplayName(providerID: string): string {
  if (providerID === "opencode-go") {
    return "OpenCode Go";
  }
  if (providerID === "opencode") {
    return "OpenCode";
  }
  return providerID;
}

export function isFreeModel(model: ModelInfo): boolean {
  return /free/i.test(model.name) || /free/i.test(model.modelID);
}

/**
 * Short form of a model name for narrow panels: the leading two words.
 * "DeepSeek V4.1 Flash 1017" → "DeepSeek V4.1", "Kimi K3.1 Pro" → "Kimi K3.1".
 * Names already that short come back unchanged.
 */
export function modelShortName(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  return tokens.length <= 2 ? tokens.join(" ") : tokens.slice(0, 2).join(" ");
}

export function groupModels(
  models: ModelInfo[],
  recentRefs: { providerID: string; id: string }[],
): { label: string; models: ModelInfo[] }[] {
  const byKey = new Map(models.map((m) => [`${m.providerID}/${m.modelID}`, m] as const));
  const sections: { label: string; models: ModelInfo[] }[] = [];

  const pool = new Map(byKey);
  const recent = recentRefs
    .map((ref) => pool.get(`${ref.providerID}/${ref.id}`))
    .filter((m): m is ModelInfo => Boolean(m));
  for (const m of recent) {
    pool.delete(`${m.providerID}/${m.modelID}`); // dedup against provider sections
  }
  if (recent.length > 0) {
    sections.push({ label: "Recent", models: recent });
  }

  const providerOrder = ["opencode-go", "opencode"];
  for (const providerID of providerOrder) {
    const list = [...pool.values()].filter((m) => m.providerID === providerID);
    for (const m of list) {
      pool.delete(`${m.providerID}/${m.modelID}`);
    }
    if (list.length > 0) {
      sections.push({ label: providerDisplayName(providerID), models: list });
    }
  }
  const otherProviders = [...new Set([...pool.values()].map((m) => m.providerID))];
  for (const providerID of otherProviders) {
    const list = [...pool.values()].filter((m) => m.providerID === providerID);
    if (list.length > 0) {
      sections.push({ label: providerDisplayName(providerID), models: list });
    }
  }
  return sections;
}

/**
 * Merge skill and file mentions for the `@` picker, filtered by the query
 * after the `@`. Skills first (CommandCode/desktop order), then files.
 */
export interface MentionOption {
  kind: "skill" | "file";
  value: string; // skill name or absolute file path
  label: string;
  description?: string;
}

export function mergeMentions(
  skills: { name: string; description?: string }[],
  files: { path: string; name: string }[],
  query: string,
): MentionOption[] {
  const q = query.trim().toLowerCase();
  const skillOptions: MentionOption[] = skills
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .map((s) => ({ kind: "skill" as const, value: s.name, label: s.name, description: s.description }));
  const fileOptions: MentionOption[] = files
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .slice(0, 15)
    .map((f) => ({ kind: "file" as const, value: f.path, label: f.name, description: f.path }));
  return [...skillOptions, ...fileOptions];
}
