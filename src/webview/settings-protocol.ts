import type { Locale } from "../util/i18n";
import type { ConfigScope } from "../util/opencode-config";

/** Which config file the server group edits. */
export type SettingsScope = ConfigScope;

/** A choice offered by one of the pickers. */
export interface SettingsChoice {
  id: string;
  label: string;
}

/** One row of the panel. */
export interface SettingsItemState {
  id: string;
  /** The value in effect — the explicit one, or the default when unset. */
  value?: unknown;
  /** True when the value is set explicitly in the current scope. */
  explicit: boolean;
  /** The default the server falls back to, when it documents one. */
  defaultValue?: unknown;
  /** The same default as text, for the "not set" hint. */
  defaultText?: string;
}

export type SettingsHostToWeb =
  | {
      kind: "settings";
      /** The display language the panel should render copy in. */
      locale?: Locale;
      items: SettingsItemState[];
      scope: SettingsScope;
      /** The file the server group edits in the current scope. */
      targetPath?: string;
      /** True when that file does not exist yet and would be created. */
      targetMissing?: boolean;
      /** Set when the target file could not be read. */
      error?: string;
      /** Server version and connection state. */
      version?: string;
      connected?: boolean;
      /** True when the server runs elsewhere and reads its own config files. */
      externalServer?: boolean;
      models?: SettingsChoice[];
      agents?: SettingsChoice[];
      shells?: SettingsChoice[];
    }
  | { kind: "settingsError"; message: string }
  | { kind: "settingsSaved"; id: string };

export type SettingsWebToHost =
  | { kind: "ready" }
  | { kind: "setServer"; id: string; value?: unknown; reset?: boolean }
  | { kind: "setScope"; scope: SettingsScope }
  | { kind: "openConfigFile" };
