import type { MessageKey } from "./i18n";

/**
 * The settings the server config panel can edit, as one list shared by the
 * extension host and the webview.
 *
 * These are all `server` items: they live in the opencode config file the
 * server reads, and the panel writes them on the user's behalf. The
 * extension's own preferences (notifications, context, connection) are VS Code
 * settings and live in the native settings page, not here.
 */

/** The control the panel renders for an item. */
export type SettingsControl = "boolean" | "number" | "lines" | "model" | "agent" | "shell";

export interface SettingsItem {
  id: string;
  labelKey: MessageKey;
  control: SettingsControl;
  /** Path inside the opencode config file. */
  configPath: string[];
  /** The value the server falls back to, when it documents one. */
  defaultValue?: unknown;
  /** The same default as text, for the "not set" hint. */
  defaultText?: string;
  /** Shown under the control. */
  hintKey?: MessageKey;
  /** The server can only write this key globally. */
  globalOnly?: boolean;
}

/** Settings the opencode server owns — written into its config file. */
export const SERVER_SETTINGS: SettingsItem[] = [
  {
    id: "model",
    labelKey: "settings.model.label",
    control: "model",
    configPath: ["model"],
    hintKey: "settings.model.hint",
  },
  {
    id: "default_agent",
    labelKey: "settings.default_agent.label",
    control: "agent",
    configPath: ["default_agent"],
    hintKey: "settings.default_agent.hint",
  },
  {
    // 工票02（opencode-sidebar）：显式锁死/调整嵌套派生。官方缺省即 1
    // （子代理不能再派生）；键在 experimental 下，官方后续可能改名——
    // 写错/被无视无害，失败软着陆。
    id: "subagent_depth",
    labelKey: "settings.subagent_depth.label",
    control: "number",
    configPath: ["experimental", "subagent_depth"],
    defaultValue: 1,
    defaultText: "1",
    hintKey: "settings.subagent_depth.hint",
  },
  {
    id: "compaction.auto",
    labelKey: "settings.compaction.auto.label",
    control: "boolean",
    configPath: ["compaction", "auto"],
    defaultValue: true,
    defaultText: "true",
  },
  {
    id: "compaction.keep.tokens",
    labelKey: "settings.compaction.keep.tokens.label",
    control: "number",
    configPath: ["compaction", "keep", "tokens"],
  },
  {
    id: "tool_output.max_lines",
    labelKey: "settings.tool_output.max_lines.label",
    control: "number",
    configPath: ["tool_output", "max_lines"],
    defaultValue: 2000,
    defaultText: "2000",
  },
  {
    id: "media.image.max_base64_bytes",
    labelKey: "settings.media.image.max_base64_bytes.label",
    control: "number",
    configPath: ["media", "image", "max_base64_bytes"],
    defaultValue: 5242880,
    defaultText: "5242880",
  },
  {
    id: "snapshots",
    labelKey: "settings.snapshots.label",
    control: "boolean",
    configPath: ["snapshots"],
    defaultValue: true,
    defaultText: "true",
  },
  {
    id: "formatter",
    labelKey: "settings.formatter.label",
    control: "boolean",
    configPath: ["formatter"],
  },
  {
    id: "instructions",
    labelKey: "settings.instructions.label",
    control: "lines",
    configPath: ["instructions"],
    hintKey: "settings.instructions.hint",
  },
  {
    id: "shell",
    labelKey: "settings.shell.label",
    control: "shell",
    configPath: ["shell"],
    globalOnly: true,
    hintKey: "settings.shell.hint",
  },
];

export function findSettingsItem(id: string): SettingsItem | undefined {
  return SERVER_SETTINGS.find((item) => item.id === id);
}

/**
 * The server accepts a model as a string or as an object; the panel edits and
 * shows the string form, which carries the variant along.
 */
export function normalizeItemValue(id: string, value: unknown): unknown {
  if (id !== "model" || !value || typeof value !== "object") {
    return value;
  }
  const record = value as { providerID?: unknown; model?: unknown; variant?: unknown };
  if (typeof record.providerID !== "string" || typeof record.model !== "string") {
    return value;
  }
  const base = `${record.providerID}/${record.model}`;
  return typeof record.variant === "string" && record.variant.length > 0 ? `${base}#${record.variant}` : base;
}
