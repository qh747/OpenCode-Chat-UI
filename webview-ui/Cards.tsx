import type { FileDiffInfo, PermissionRequest } from "../src/opencode/types";

export type { ComposerHandle } from "./composerTypes";

// --- permission card ------------------------------------------------------

interface PermissionProps {
  request: PermissionRequest;
  onReply: (requestID: string, decision: "once" | "always" | "reject") => void;
}

export function PermissionCard({ request, onReply }: PermissionProps) {
  return (
    <div className="permission-card">
      <div className="permission-title">Permission required</div>
      <div className="permission-action">
        <span className="action-badge">{request.action}</span>
        {request.resources.length > 0 && (
          <span className="permission-resources">{request.resources.join(", ")}</span>
        )}
      </div>
      {request.message && <div className="permission-message">{request.message}</div>}
      <div className="permission-buttons">
        <button className="btn primary" onClick={() => onReply(request.id, "once")}>
          Allow once
        </button>
        <button className="btn" onClick={() => onReply(request.id, "always")}>
          Always allow
        </button>
        <button className="btn danger" onClick={() => onReply(request.id, "reject")}>
          Deny
        </button>
      </div>
    </div>
  );
}

// --- diff card ------------------------------------------------------------

interface DiffProps {
  diffs: FileDiffInfo[];
  onOpen: (file: string) => void;
  onKeep: (file: string) => void;
  onRevert: (file: string) => void;
}

export function DiffList({ diffs, onOpen, onKeep, onRevert }: DiffProps) {
  if (diffs.length === 0) {
    return null;
  }
  return (
    <div className="diff-list">
      <div className="diff-list-title">Changes</div>
      {diffs.map((diff) => (
        <div key={diff.file} className="diff-card">
          <button className="diff-file" onClick={() => onOpen(diff.file)} title={diff.file}>
            <span className="diff-status-badge">{diff.status}</span>
            <span className="diff-name">{fileName(diff.file)}</span>
          </button>
          <span className="diff-stats">
            <span className="additions">+{diff.additions}</span>
            <span className="deletions">-{diff.deletions}</span>
          </span>
          <span className="diff-buttons">
            <button className="btn small" onClick={() => onKeep(diff.file)} title="Keep this change">
              Keep
            </button>
            <button
              className="btn small danger"
              onClick={() => onRevert(diff.file)}
              title="Revert this file to its previous state"
            >
              Revert
            </button>
          </span>
        </div>
      ))}
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
      <div className="welcome-logo" aria-hidden="true">
        {/* OpenCode mark: outline style (matches the activity-bar icon) */}
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none">
          <rect x="3.2" y="3.2" width="17.6" height="17.6" stroke="currentColor" strokeWidth="1.6" />
          <rect x="8" y="8" width="8" height="8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <h1 className="welcome-title">OpenCode</h1>
      <p className="welcome-sub">What should we work on?</p>
      <div className="welcome-tips">
        <div className="tip">
          <span className="tip-key">@</span> mention a file to add context
        </div>
        <div className="tip">
          <span className="tip-key">📷</span> paste or drop images into the composer
        </div>
        <div className="tip">
          <span className="tip-key">⇥</span> Shift+Tab switches build / plan modes
        </div>
        <div className="tip">
          <span className="tip-key">⏪</span> hover one of your messages to rewind
        </div>
      </div>
      <p className="welcome-version">
        {version ? `opencode v${version} · ` : ""}subscription models live under{" "}
        <code>opencode-go/*</code>
      </p>
    </div>
  );
}
