import type { GitInfo } from "../src/webview/protocol";
import type { TokenUsage } from "../src/opencode/types";
import { t } from "../src/util/i18n";

export interface ContextBarProps {
  git?: GitInfo;
  workspacePath?: string;
  cost?: number;
  tokens?: TokenUsage;
  /** Context window of the active model, when known. */
  contextLimit?: number;
}

/**
 * One-line context strip under the composer: git branch and workspace path on
 * the left, context usage and cost on the right.
 */
export function ContextBar({ git, workspacePath, cost, tokens, contextLimit }: ContextBarProps) {
  const used = tokens ? totalTokens(tokens) : undefined;
  const hasUsage = used !== undefined || cost !== undefined;
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
          {used !== undefined && cost !== undefined && <span className="ctx-sep">|</span>}
          {cost !== undefined && <span title={t("sessionCostTitle")}>${cost.toFixed(4)}</span>}
        </span>
      )}
    </div>
  );
}

function totalTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
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
