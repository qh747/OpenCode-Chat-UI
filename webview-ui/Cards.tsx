import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { FileDiffInfo, PermissionRequest } from "../src/opencode/types";
import { t } from "../src/util/i18n";

export type { ComposerHandle } from "./composerTypes";

// --- permission card ------------------------------------------------------

interface PermissionProps {
  request: PermissionRequest;
  onReply: (requestID: string, decision: "once" | "always" | "reject") => void;
}

export function PermissionCard({ request, onReply }: PermissionProps) {
  return (
    <div className="permission-card">
      <div className="permission-title">{t("permissionRequired")}</div>
      <div className="permission-action">
        <span className="action-badge">{request.action}</span>
        {request.resources.length > 0 && (
          <span className="permission-resources">{request.resources.join(", ")}</span>
        )}
      </div>
      {request.message && <div className="permission-message">{request.message}</div>}
      <div className="permission-buttons">
        <button className="btn primary" onClick={() => onReply(request.id, "once")}>
          {t("allowOnce")}
        </button>
        <button className="btn" onClick={() => onReply(request.id, "always")}>
          {t("alwaysAllow")}
        </button>
        <button className="btn danger" onClick={() => onReply(request.id, "reject")}>
          {t("deny")}
        </button>
      </div>
    </div>
  );
}

// --- diff card ------------------------------------------------------------

interface DiffProps {
  diffs: FileDiffInfo[];
  /** Rows visible before the expanded list scrolls (from `opencode.diffList.maxVisibleRows`). */
  maxVisibleRows: number;
  /** Test hook: render with the rows expanded (default is collapsed). */
  initialOpen?: boolean;
  onOpen: (file: string) => void;
  onRevert: (file: string) => void;
}

/**
 * The files the agent changed. Collapsed to a single header row by default —
 * the count is the signal, the rows are only for acting on one — expanding
 * reveals the per-file revert action. When open, rows beyond `maxVisibleRows`
 * scroll inside the card instead of stretching the panel. Each row encodes
 * the change type as an `st-<status>` class (the filename is coloured in CSS);
 * there is no status text badge and no header total.
 */
export function DiffList({ diffs, maxVisibleRows, initialOpen = false, onOpen, onRevert }: DiffProps) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    if (diffs.length === 0) {
      setOpen(false);
    }
  }, [diffs.length]);

  if (diffs.length === 0) {
    return null;
  }
  return (
    <div className="diff-list">
      {/* 整行即按钮（subagent-nav）：对齐 .subagent-head 的整行热区，
          caret 和计数只是行内的展示，不再单独构成一个小按钮。 */}
      <button
        type="button"
        className="diff-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={open ? t("diffCollapse") : t("diffExpand")}
      >
        <span className="diff-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="diff-count">{t("changesCount", { count: diffs.length })}</span>
      </button>
      <div
        className="diff-rows"
        style={{ "--diff-max-rows": String(maxVisibleRows) } as CSSProperties}
      >
        {open &&
          diffs.map((diff) => (
            <div key={diff.file} className={`diff-card st-${diff.status}`}>
              <button className="diff-file" onClick={() => onOpen(diff.file)} title={diff.file}>
                <span className="diff-name">{fileName(diff.file)}</span>
              </button>
              <span className="diff-stats">
                <span className="additions">+{diff.additions}</span>
                <span className="deletions">-{diff.deletions}</span>
              </span>
              <span className="diff-buttons">
                <button
                  className="diff-revert"
                  onClick={() => onRevert(diff.file)}
                  title={t("revertFileTitle")}
                  aria-label={t("revertFileTitle")}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function fileName(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

// --- welcome --------------------------------------------------------------

export function Welcome({ version }: { version?: string }) {
  return (
    <div className="welcome">
      <div className="welcome-prompt">
        <span className="welcome-caret" aria-hidden="true">
          ›
        </span>
        <span className="welcome-hint">{t("welcomePrompt")}</span>
      </div>
      {version && <div className="welcome-version">opencode v{version}</div>}
    </div>
  );
}
