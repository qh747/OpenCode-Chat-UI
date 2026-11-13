import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  text: string;
  className?: string;
}

/** Markdown renderer, sanitized for the webview CSP. */
export function Markdown({ text, className }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(text) as string;
    return DOMPurify.sanitize(raw, {
      FORBID_TAGS: ["style", "form", "input", "iframe"],
      ADD_ATTR: ["target"],
    });
  }, [text]);
  return (
    <div
      className={className ? `md ${className}` : "md"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
