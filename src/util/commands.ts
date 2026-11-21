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
 * 光标前缀内的尾部 `/` 触发（spec 分支 5：任意光标位置的 `/` 都能唤起命令/
 * skills 菜单，不再要求整段文本以 `/` 开头）。与 mention-trigger.ts 的
 * mentionTail 同款形状：只对光标前缀做尾部匹配——`/` 之后直到光标处不能
 * 有空格或另一个 `/`。已知取舍：URL 与「3/4」里的 `/` 也会触发，靠空格、
 * 查询无匹配或 Esc（仅 @ 有抑制）收场；这是「任意位置触发」的代价。
 */
export interface CommandTail {
  /** `/` 之后的查询词（到光标为止），可能为空串。 */
  query: string;
  /** 触发字符 `/` 在全文中的下标。 */
  atIndex: number;
  /** 检测时使用的光标位置（已钳制进文本范围）。 */
  caret: number;
}

/**
 * 在 `text` 的 `caret` 前缀内寻找尾部 `/` 触发。`caret` 缺省为文本末尾；
 * 越界值会被钳制。命中返回 `CommandTail`，否则 `undefined`（不触发）。
 */
export function commandTail(text: string, caret?: number): CommandTail | undefined {
  const end =
    caret === undefined ? text.length : Math.max(0, Math.min(caret, text.length));
  const match = /\/([^\s/]*)$/.exec(text.slice(0, end));
  if (!match) {
    return undefined;
  }
  return { query: match[1] ?? "", atIndex: match.index, caret: end };
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
 * File mentions for the `@` picker, filtered by the query after the `@`.
 * Skills are only surfaced by the `/` picker (see filterSkills) — a skill
 * mention must use the skill's id, which the user cannot guess from the
 * display name alone.
 */
export interface MentionOption {
  value: string; // absolute file path
  label: string;
  description?: string;
}

export function mergeMentions(
  files: { path: string; name: string }[],
  query: string,
): MentionOption[] {
  const q = query.trim().toLowerCase();
  return files
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .slice(0, 15)
    .map((f) => ({ value: f.path, label: f.name, description: f.path }));
}

/**
 * Skills for the `/` picker, matched on the id (what a mention must spell) and
 * the display name (what the user looks for). The display name is shown in the
 * row; selecting a row inserts `@<id>`.
 */
export interface SkillOption {
  id: string;
  name: string;
  description?: string;
}

export function filterSkills(skills: SkillOption[], query: string): SkillOption[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...skills];
  }
  return skills.filter(
    (skill) => skill.id.toLowerCase().includes(q) || skill.name.toLowerCase().includes(q),
  );
}

/** Exact id match for a typed `/command`: an id that names a skill is a skill
 *  mention, not a server command. */
export function findSkillByCommand(skills: SkillOption[], command: string): SkillOption | undefined {
  const normalized = command.replace(/^\//, "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return skills.find((skill) => skill.id.toLowerCase() === normalized);
}
