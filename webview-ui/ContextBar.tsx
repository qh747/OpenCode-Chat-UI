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
 * One-line context strip under the composer: git branch and workspace path on
 * the left, context usage and cache hit rate on the right. The usage segment
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
  const hasUsage = used !== undefined || cacheHitRate !== undefined;
  if (!git?.branch && !workspacePath && !hasUsage) {
    return null;
  }
  return (
    <div className="ctx-bar">
      {git?.branch ? (
        <>
          {onOpenSourceControl ? (
            <button
              className="ctx-branch ctx-link"
              title={t("openSourceControlTitle")}
              onClick={onOpenSourceControl}
            >
              ⎇ {git.branch}
            </button>
          ) : (
            <span className="ctx-branch">⎇ {git.branch}</span>
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
      {workspacePath &&
        (onRevealInExplorer ? (
          <button
            className="ctx-path ctx-link"
            title={`${t("revealInExplorerTitle")} · ${workspacePath}`}
            onClick={onRevealInExplorer}
          >
            {workspacePath}
          </button>
        ) : (
          <span className="ctx-path" title={workspacePath}>
            {workspacePath}
          </span>
        ))}
      {hasUsage &&
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

function UsageReadout({
  used,
  contextLimit,
  cacheHitRate,
}: {
  used?: number;
  contextLimit?: number;
  cacheHitRate?: number;
}) {
  return (
    <>
      {used !== undefined && (
        <span title={t("contextTokensTitle")}>
          {formatTokens(used)}
          {contextLimit ? ` / ${formatTokens(contextLimit)}` : ""}
        </span>
      )}
      {used !== undefined && cacheHitRate !== undefined && <span className="ctx-sep">|</span>}
      {cacheHitRate !== undefined && (
        <span title={t("cacheHitRateTitle")}>{(cacheHitRate * 100).toFixed(0)}%</span>
      )}
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
