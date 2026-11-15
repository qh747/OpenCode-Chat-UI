/**
 * Reading and editing the opencode server configuration (`opencode.json` /
 * `opencode.jsonc`).
 *
 * The panel edits these files directly: the server's HTTP surface can only
 * write `shell`, so every other key has to land on disk. `jsonc-parser` is
 * the same library the server itself uses to write its config, so edits keep
 * the user's comments and formatting instead of rewriting the file.
 */
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Config file names, in the order the server resolves them. */
export const CONFIG_NAMES = ["opencode.json", "opencode.jsonc"] as const;

/** Which configuration file a scope edits. */
export type ConfigScope = "global" | "project";

/** Which config file a scope points at. */
export interface ConfigTarget {
  /** Directory the file lives in. */
  dir: string;
  /** Absolute path of the file to edit. */
  file: string;
  /** True when the file does not exist yet and would be created. */
  missing: boolean;
}

export interface ParsedConfig {
  ok: boolean;
  data: Record<string, unknown>;
  error?: string;
}

/**
 * Global config directory, resolved the way the server resolves it:
 * `OPENCODE_CONFIG_DIR`, then `XDG_CONFIG_HOME/opencode`, then
 * `~/.config/opencode`. The extension and the server it spawns see the same
 * environment, so both land on the same directory.
 */
export function globalConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const explicit = env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return path.join(xdg, "opencode");
  }
  return path.join(home, ".config", "opencode");
}

/**
 * The file to edit inside `dir`. The server takes the last existing name from
 * `opencode.json` / `opencode.jsonc` and creates `opencode.jsonc` when
 * neither exists; the CLI takes `opencode.json` instead. We follow the
 * server, because the server is what reads the file.
 */
export function resolveConfigFile(
  dir: string,
  exists: (file: string) => boolean = fs.existsSync,
): ConfigTarget {
  for (const name of [...CONFIG_NAMES].reverse()) {
    const file = path.join(dir, name);
    if (exists(file)) {
      return { dir, file, missing: false };
    }
  }
  return { dir, file: path.join(dir, "opencode.jsonc"), missing: true };
}

/** Parse a config file, tolerating comments and trailing commas. */
export function parseConfig(text: string): ParsedConfig {
  const errors: ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length > 0) {
    return { ok: false, data: {}, error: describeParseError(errors[0]!) };
  }
  if (data === undefined || data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, data: {}, error: "Config file is not a JSON object." };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

/**
 * jsonc-parser's ParseErrorCode values, spelled out because the enum is an
 * ambient const enum and cannot be referenced under isolatedModules.
 */
const PARSE_ERROR_TEXT: Record<number, string> = {
  1: "Invalid symbol",
  2: "Invalid number",
  3: "Expected a property name",
  4: "Expected a value",
  5: "Expected ':'",
  6: "Expected ',' or '}'",
  7: "Expected '}'",
  8: "Expected ']'",
  9: "Unexpected end of file",
  10: "Invalid comment",
  11: "Unterminated comment",
  12: "Unterminated string",
  13: "Unterminated number",
  14: "Invalid unicode escape",
  15: "Invalid escape character",
  16: "Invalid character",
};

function describeParseError(error: ParseError): string {
  const text = PARSE_ERROR_TEXT[error.error] ?? "Invalid JSONC";
  return `${text} at offset ${error.offset}.`;
}

/** Read the value at `keyPath`, or undefined when the key is absent. */
export function valueAtPath(data: unknown, keyPath: string[]): unknown {
  let current = data;
  for (const key of keyPath) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a key in the config text; `value === undefined` removes it. Everything
 * outside the edited range — comments, spacing, other keys — survives byte
 * for byte.
 */
export function applyConfigValue(text: string, keyPath: string[], value: unknown): string {
  const edits = modify(text, keyPath, value === undefined ? undefined : value, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  });
  return applyEdits(text, edits);
}

/**
 * Apply a value and re-validate the result, so a broken file is reported
 * instead of written.
 */
export function updateConfigText(text: string, keyPath: string[], value: unknown): string {
  const parsed = parseConfig(text);
  if (!parsed.ok) {
    throw new Error(parsed.error ?? "Config file is not valid JSONC.");
  }
  const next = applyConfigValue(text, keyPath, value);
  const check = parseConfig(next);
  if (!check.ok) {
    throw new Error(check.error ?? "Config file would become invalid.");
  }
  return next;
}
