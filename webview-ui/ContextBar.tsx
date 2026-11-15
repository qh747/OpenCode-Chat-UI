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
}

/**
 * One-line context strip under the composer: git branch and workspace path on
 * the left, context usage and cache hit rate on the right.
 */
export function ContextBar({ git, workspacePath, contextTokens, cacheHitRate, contextLimit }: ContextBarProps) {
  const used = contextTokens;
  const hasUsage = used !== undefined || cacheHitRate !== undefined;
  if (!git?.branch && !workspacePath && !hasUsage) {
    return null;
  }
  return (
    <div className="ctx-bar">
      {git?.branch ? (
        <>
          <span className="ctx-branch">⎇ {git.branch}</span>
          {git.dirty && <span className="ctx-dirty">*</span>}
          <span className="ctx-sep">|</span>
        </>
      ) : git ? (
        <>
          <span className="ctx-nogit">{t("noGit")}</span>
          <span className="ctx-sep">|</span>
        </>
      ) : null}
      {workspacePath && (
        <span className="ctx-path" title={workspacePath}>
          {workspacePath}
        </span>
      )}
      {hasUsage && (
        <span className="ctx-right">
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
        </span>
      )}
    </div>
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
