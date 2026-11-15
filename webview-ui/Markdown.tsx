import { useMemo, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { t } from "../src/util/i18n";

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  text: string;
  className?: string;
  /** Links cannot navigate inside the webview; the host opens them externally. */
  onOpenUrl?: (url: string) => void;
  /** Code blocks get a copy button; the host owns the clipboard. */
  onCopyCode?: (text: string) => void;
}

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * DOMPurify needs a DOM. In the webview it has one; under `node:test` it
 * degrades to a factory, so fall back to a conservative strip instead of
 * rendering unsanitised HTML.
 */
const purifier = typeof DOMPurify.sanitize === "function" ? DOMPurify : undefined;

function stripUnsafe(html: string): string {
  return html
    .replace(/<(script|style|iframe|form|input)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|form|input)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

/** Fenced code as marked renders it, before we wrap it with a header. */
const CODE_BLOCK = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

/**
 * Wrap code blocks in a header (language + copy) and tables in a scroll
 * container. Runs after sanitising, so the language it re-inserts is already
 * escaped.
 */
function decorate(html: string, copyLabel: string): string {
  return html
    .replace(
      CODE_BLOCK,
      (_match, language: string | undefined, body: string) =>
        `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${language ?? ""}</span>` +
        `<button class="md-code-copy" type="button">${copyLabel}</button></div>` +
        `<pre><code${language ? ` class="language-${language}"` : ""}>${body}</code></pre></div>`,
    )
    .replace(/<table>/g, '<div class="md-table"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

/** Markdown renderer, sanitized for the webview CSP. */
export function Markdown({ text, className, onOpenUrl, onCopyCode }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(text) as string;
    const sanitized = purifier
      ? purifier.sanitize(raw, { FORBID_TAGS: ["style", "form", "input", "iframe"] })
      : stripUnsafe(raw);
    return decorate(sanitized, t("copy"));
  }, [text]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const copyButton = target.closest(".md-code-copy");
    if (copyButton && onCopyCode) {
      const code = copyButton.closest(".md-code")?.querySelector("code")?.textContent ?? "";
      event.preventDefault();
      onCopyCode(code);
      copyButton.textContent = t("copied");
      window.setTimeout(() => {
        copyButton.textContent = t("copy");
      }, 1200);
      return;
    }
    if (!onOpenUrl) {
      return;
    }
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href) {
      return;
    }
    event.preventDefault();
    if (EXTERNAL.test(href)) {
      onOpenUrl(href);
    }
  };

  return (
    <div
      className={className ? `md ${className}` : "md"}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
