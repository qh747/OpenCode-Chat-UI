import type { GitInfo } from "../src/webview/protocol";
import { t } from "../src/util/i18n";

export interface ContextBarProps {
  git?: GitInfo;
  workspacePath?: string;
  /** Tokens of the latest billed assistant message (context occupancy). */
  contextTokens?: number;
  /** Cache hit rate of the same message (0..1). */
  cacheHitRate?: number;
  /** Context window of the active model, when known. */
  contextLimit?: number;
  /** Opens the session-info slide-over; absent leaves the plain readout. */
  onSessionInfo?: () => void;
  /** Switches to the Source Control view; absent leaves the plain text. */
  onOpenSourceControl?: () => void;
  /** Reveals the workspace folder in the Explorer; absent leaves plain text. */
  onRevealInExplorer?: () => void;
}

/**
 * One-line context strip under the composer: git branch and workspace folder on
 * the left, context usage and cache hit rate on the right. The folder shows its
 * last segment only — the full path stays in the tooltip. The usage segment
 * doubles as the session-info opener when a handler is passed.
 */
export function ContextBar({
  git,
  workspacePath,
  contextTokens,
  cacheHitRate,
  contextLimit,
  onSessionInfo,
  onOpenSourceControl,
  onRevealInExplorer,
}: ContextBarProps) {
  const used = contextTokens;
  // A fresh session has no billed message yet, so there is no usage to report.
  // The model's context window is still known, and the readout must not vanish
  // between session creation and the first token report — show 0 of the limit
  // and a 100% cache rate (nothing billed, nothing missed) until the server
  // bills the first assistant turn.
  const showUsage = used !== undefined || cacheHitRate !== undefined || contextLimit !== undefined;
  // The strip never disappears now: the workspace segment always has a value,
  // either the folder name or the no-dir marker, so an empty workspace still
  // explains itself instead of leaving the composer without context.
  return (
    <div className="ctx-bar">
      {git?.branch ? (
        <>
          {onOpenSourceControl ? (
            <button
              className="ctx-branch ctx-link"
              title={branchTitle(git)}
              onClick={onOpenSourceControl}
            >
              {git.branch}
            </button>
          ) : (
            <span className="ctx-branch" title={git.directory ? branchTitle(git) : undefined}>
              {git.branch}
            </span>
          )}
          {git.dirty && <span className="ctx-dirty">*</span>}
          <span className="ctx-sep">|</span>
        </>
      ) : git ? (
        <>
          <span className="ctx-nogit">{t("noGit")}</span>
          <span className="ctx-sep">|</span>
        </>
      ) : null}
      {workspacePath ? (
        onRevealInExplorer ? (
          <button
            className="ctx-path ctx-link"
            title={`${t("revealInExplorerTitle")} · ${workspacePath}`}
            onClick={onRevealInExplorer}
          >
            {folderName(workspacePath)}
          </button>
        ) : (
          <span className="ctx-path" title={workspacePath}>
            {folderName(workspacePath)}
          </span>
        )
      ) : (
        <span className="ctx-path ctx-nodir" title={t("noWorkspace")}>
          {t("noDir")}
        </span>
      )}
      {showUsage &&
        (onSessionInfo ? (
          <button className="ctx-right ctx-usage-btn" title={t("sessionInfoTitle")} onClick={onSessionInfo}>
            <UsageReadout used={used} contextLimit={contextLimit} cacheHitRate={cacheHitRate} />
          </button>
        ) : (
          <span className="ctx-right">
            <UsageReadout used={used} contextLimit={contextLimit} cacheHitRate={cacheHitRate} />
          </span>
        ))}
    </div>
  );
}

/** Tooltip for the branch segment: the default names the SCM view; when the
 *  branch belongs to a worktree or a moved session's directory (ADR-0013),
 *  the tooltip explains where it came from — the click still opens SCM. */
function branchTitle(git: GitInfo): string {
  if (!git.directory) {
    return t("openSourceControlTitle");
  }
  return `${t("branchDirTitle")} · ${git.directory}`;
}

function UsageReadout({
  used,
  contextLimit,
  cacheHitRate,
}: {
  used?: number;
  contextLimit?: number;
  cacheHitRate?: number;
}) {
  const tokens = used ?? 0;
  return (
    <>
      <span title={t("contextTokensTitle")}>
        {formatTokens(tokens)}
        {contextLimit ? ` / ${formatTokens(contextLimit)}` : ""}
      </span>
      <span className="ctx-sep">|</span>
      <span title={t("cacheHitRateTitle")}>
        {cacheHitRate !== undefined ? `${(cacheHitRate * 100).toFixed(0)}%` : "100%"}
      </span>
    </>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

/** Last segment of a Unix or Windows path; trailing separators are ignored. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  const name = parts[parts.length - 1];
  return name || trimmed || path;
}
