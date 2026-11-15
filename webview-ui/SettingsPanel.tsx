import { useEffect, useState } from "react";
import { Dropdown } from "./Dropdown";
import type {
  SettingsChoice,
  SettingsItemState,
  SettingsScope,
  SettingsWebToHost,
} from "../src/webview/settings-protocol";
import { SERVER_SETTINGS, type SettingsItem } from "../src/util/settings-items";
import { t } from "../src/util/i18n";

export interface SettingsPanelProps {
  items: SettingsItemState[];
  scope: SettingsScope;
  targetPath?: string;
  targetMissing?: boolean;
  externalServer?: boolean;
  version?: string;
  connected?: boolean;
  models: SettingsChoice[];
  agents: SettingsChoice[];
  shells: SettingsChoice[];
  error?: string;
  saved?: string;
  send: (message: SettingsWebToHost) => void;
}

/**
 * The server config surface: every row writes into the opencode config file
 * the server reads, showing what is actually stored.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const { items, scope, send } = props;
  const stateOf = (id: string) => items.find((item) => item.id === id);

  return (
    <div className="settings">
      <div className="settings-head">
        <span className="settings-title">{t("serverPanelTitle")}</span>
        <span className="spacer" />
        <span className="settings-version">
          {props.connected ? `opencode v${props.version ?? "?"}` : t("serverNotConnected")}
        </span>
      </div>

      {props.error && <div className="banner error">{props.error}</div>}
      {props.externalServer && <div className="banner warn">{t("externalServerWarn")}</div>}

      <div className="settings-body">
        <section className="settings-group">
          <div className="settings-group-head">
            <h2 className="settings-group-title">{t("serverConfigGroup")}</h2>
            <div className="settings-scope">
              <button
                className={`settings-scope-btn${scope === "global" ? " active" : ""}`}
                onClick={() => send({ kind: "setScope", scope: "global" })}
              >
                {t("scopeGlobal")}
              </button>
              <button
                className={`settings-scope-btn${scope === "project" ? " active" : ""}`}
                onClick={() => send({ kind: "setScope", scope: "project" })}
              >
                {t("scopeProject")}
              </button>
            </div>
          </div>
          <div className="settings-target" title={props.targetPath}>
            {props.targetPath}
            {props.targetMissing && <span className="settings-target-new"> {t("newFileHint")}</span>}
          </div>
          {SERVER_SETTINGS.map((item) => (
            <Row
              key={item.id}
              item={item}
              state={stateOf(item.id)}
              choices={choicesFor(item, props)}
              disabled={scope === "project" && item.globalOnly === true}
              saved={props.saved === item.id}
              send={send}
            />
          ))}
          <button className="settings-link" onClick={() => send({ kind: "openConfigFile" })}>
            {t("openConfigFile")}
          </button>
        </section>
      </div>
    </div>
  );
}

function choicesFor(item: SettingsItem, props: SettingsPanelProps): SettingsChoice[] {
  if (item.control === "model") {
    return props.models;
  }
  if (item.control === "agent") {
    return props.agents;
  }
  if (item.control === "shell") {
    return props.shells;
  }
  return [];
}

interface RowProps {
  item: SettingsItem;
  state: SettingsItemState | undefined;
  choices?: SettingsChoice[];
  disabled?: boolean;
  saved?: boolean;
  send: (message: SettingsWebToHost) => void;
}

function Row({ item, state, choices = [], disabled, saved, send }: RowProps) {
  const value = state?.value;
  const label = t(item.labelKey);
  const onChange = (next: unknown) => {
    send({ kind: "setServer", id: item.id, value: next });
  };
  const onReset = () => {
    send({ kind: "setServer", id: item.id, reset: true });
  };

  const control = (() => {
    switch (item.control) {
      case "boolean":
        return (
          <button
            className={`switch${value === true ? " on" : ""}`}
            role="switch"
            aria-checked={value === true}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!(value === true))}
          />
        );
      case "number":
        return (
          <NumberField
            value={typeof value === "number" ? value : undefined}
            disabled={disabled}
            onCommit={onChange}
          />
        );
      case "lines":
        return (
          <LinesField
            value={Array.isArray(value) ? value.join("\n") : ""}
            disabled={disabled}
            onCommit={onChange}
          />
        );
      case "model":
      case "agent":
        return (
          <ChoiceField
            value={typeof value === "string" ? value : ""}
            choices={choices}
            disabled={disabled}
            placeholder={t("notSetPlaceholder")}
            onChange={onChange}
          />
        );
      case "shell":
        return choices.length > 0 ? (
          <ChoiceField
            value={typeof value === "string" ? value : ""}
            choices={choices}
            disabled={disabled}
            placeholder={t("notSetPlaceholder")}
            onChange={onChange}
          />
        ) : (
          <TextField
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            placeholder={t("serverDefaultPlaceholder")}
            onCommit={onChange}
          />
        );
    }
  })();

  const unset =
    state && !state.explicit && state.defaultText
      ? t("notSetWithDefault", { default: state.defaultText })
      : undefined;

  return (
    <div className={`settings-row${disabled ? " disabled" : ""}`}>
      <div className="settings-row-main">
        <div className="settings-row-label">
          <span>{label}</span>
          {saved && <span className="settings-row-saved">{t("savedMarker")}</span>}
        </div>
        <div className="settings-row-control">{control}</div>
      </div>
      {(item.hintKey || unset) && (
        <div className="settings-row-hint">
          {unset}
          {unset && item.hintKey ? " · " : ""}
          {item.hintKey ? t(item.hintKey) : ""}
        </div>
      )}
      {state?.explicit && (
        <button className="settings-row-reset" onClick={onReset} title={t("resetToDefault")}>
          {t("resetLabel")}
        </button>
      )}
    </div>
  );
}

function ChoiceField({
  value,
  choices,
  disabled,
  placeholder,
  onChange,
}: {
  value: string;
  choices: SettingsChoice[];
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const options = choices.map((choice) => ({ value: choice.id, label: choice.label }));
  if (value && !options.some((option) => option.value === value)) {
    options.push({ value, label: value });
  }
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      placeholder={placeholder}
      below
      disabled={disabled}
      className="settings-dropdown"
    />
  );
}

function NumberField({
  value,
  disabled,
  onCommit,
}: {
  value: number | undefined;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      className="field settings-number"
      type="number"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const parsed = Number(text);
        if (text.trim() !== "" && Number.isFinite(parsed)) {
          onCommit(parsed);
        } else {
          setText(value === undefined ? "" : String(value));
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function LinesField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (value: string[]) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      className="field settings-lines"
      rows={3}
      value={text}
      disabled={disabled}
      placeholder={t("onePerLine")}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text.split("\n").map((line) => line.trim()).filter(Boolean))}
    />
  );
}

function TextField({
  value,
  disabled,
  placeholder,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="field"
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
