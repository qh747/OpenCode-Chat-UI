import { useState } from "react";
import type { FormAnswerValue, FormField, FormInfo } from "../src/opencode/types";
import { t } from "../src/util/i18n";

type FieldValues = Record<string, string | string[]>;

/**
 * Assemble the wire answer from per-field UI state. A string field answers
 * with a plain string (an array is rejected server-side as
 * FormInvalidAnswerError), a multiselect field with an array of strings.
 */
export function buildFormAnswer(fields: FormField[], values: FieldValues): Record<string, FormAnswerValue> {
  const answer: Record<string, FormAnswerValue> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === "multiselect") {
      const extra = typeof value === "string" && value.trim() ? [value.trim()] : [];
      answer[field.key] = [...(Array.isArray(value) ? value : []), ...extra];
      continue;
    }
    answer[field.key] = typeof value === "string" ? value : "";
  }
  return answer;
}

/** Required fields must carry a non-empty answer before submit is enabled. */
export function formAnswerComplete(fields: FormField[], values: FieldValues): boolean {
  for (const field of fields) {
    if (field.hidden || !field.required) {
      continue;
    }
    const value = values[field.key];
    if (field.type === "multiselect") {
      if (!Array.isArray(value) || value.length === 0) {
        return false;
      }
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }
  }
  return true;
}

/** 选项字母标号：A. B. C. …；超过 26 个回绕（实践到不了）。 */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

function initialValues(fields: FormField[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.default !== undefined) {
      values[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
    } else {
      values[field.key] = field.type === "multiselect" ? [] : "";
    }
  }
  return values;
}

/**
 * The interactive card for a pending session form — what the server's
 * `question` tool blocks the turn on. Rendered above the composer, one card
 * per pending form, in the same slot as the permission card.
 */
export function QuestionForm({
  form,
  onReply,
  onCancel,
}: {
  form: FormInfo;
  onReply: (formID: string, answer: Record<string, FormAnswerValue>) => void;
  onCancel: (formID: string) => void;
}) {
  const fields = form.fields.filter((field) => !field.hidden);
  const [values, setValues] = useState<FieldValues>(() => initialValues(fields));
  const setValue = (key: string, value: string | string[]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const toggleOption = (field: FormField, optionValue: string) => {
    if (field.type === "multiselect") {
      const selected = Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [];
      setValue(
        field.key,
        selected.includes(optionValue)
          ? selected.filter((item) => item !== optionValue)
          : [...selected, optionValue],
      );
      return;
    }
    // Single choice: clicking the selected option clears it again.
    setValue(field.key, values[field.key] === optionValue ? "" : optionValue);
  };

  const submit = () => {
    if (!formAnswerComplete(fields, values)) {
      return;
    }
    onReply(form.id, buildFormAnswer(fields, values));
  };

  return (
    <div className="question-card">
      <div className="question-title">{form.title || t("questionTitle")}</div>
      {fields.map((field) => (
        <div className="q-field" key={field.key}>
          {field.title && <div className="q-label">{field.title}</div>}
          {field.description && <div className="q-desc">{field.description}</div>}
          {field.options && field.options.length > 0 && (
            <div className={`q-options${field.type === "multiselect" ? " multi" : ""}`}>
              {field.options.map((option, index) => {
                const selected =
                  field.type === "multiselect"
                    ? Array.isArray(values[field.key]) && (values[field.key] as string[]).includes(option.value)
                    : values[field.key] === option.value;
                return (
                  <button
                    key={option.value}
                    className={`q-option${selected ? " selected" : ""}`}
                    onClick={() => toggleOption(field, option.value)}
                    title={option.description}
                  >
                    <span className="q-option-line">
                      <span className="q-option-key">{optionLetter(index)}.</span>
                      <span className="q-option-label">{option.label}</span>
                    </span>
                    {option.description && <span className="q-option-desc">{option.description}</span>}
                  </button>
                );
              })}
              {field.type === "multiselect" && <span className="q-hint">{t("questionMultiHint")}</span>}
            </div>
          )}
          {/* `question` 工具总是允许自由作答（服务端把每个字段 custom 置真）：
              选项题里非空的自定义回答覆盖所选选项；多选题里作为追加项。 */}
          {(!field.options || field.options.length === 0 || field.custom !== false) && (
            <input
              className="q-custom"
              type="text"
              value={typeof values[field.key] === "string" ? (values[field.key] as string) : ""}
              onChange={(event) => setValue(field.key, event.target.value)}
              placeholder={field.placeholder ?? t("questionCustomPlaceholder")}
            />
          )}
        </div>
      ))}
      <div className="question-buttons">
        <button className="btn primary" onClick={submit} disabled={!formAnswerComplete(fields, values)}>
          {t("questionSubmit")}
        </button>
        <button
          className="btn"
          onClick={() => onCancel(form.id)}
          title={t("questionSkipTitle")}
        >
          {t("questionSkip")}
        </button>
      </div>
    </div>
  );
}
