import type { StoredFileAttachment } from "../opencode/types";

/**
 * How a user message presents the things it points at: a workspace file, a
 * selection inside one, a pasted image, or a link.
 */
export type AttachmentKind = "file" | "image" | "selection" | "url";

export interface AttachmentItem {
  kind: AttachmentKind;
  /** The name shown as the row's title. */
  name: string;
  /** The dim second line: a path, a line range, or the URL. */
  detail?: string;
  /** A workspace path the row can open in the editor. */
  path?: string;
  /** 1-indexed inclusive line range, for selections. */
  start?: number;
  end?: number;
  /** The URL the row opens in the browser. */
  url?: string;
  /** The image itself, as a `data:` URI. */
  image?: string;
  /** The image's mime type, for the preview's header. */
  mime?: string;
}

/**
 * The host has no attachment form for a link — the prompt API only accepts
 * `data:` and `file:` URIs — so a link travels inside the message text, one
 * per line, behind this marker. The webview reads them back out to show
 * them as attachments instead of as bare text.
 */
export const LINK_MARKER = "参考链接: ";

/** The body of a message and the links that were folded into it. */
export function extractLinks(text: string): { body: string; links: string[] } {
  const lines = text.split("\n");
  const links: string[] = [];
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]?.trim() ?? "";
    if (!line.startsWith(LINK_MARKER)) {
      break;
    }
    const url = line.slice(LINK_MARKER.length).trim();
    if (url) {
      links.unshift(url);
    }
    end -= 1;
  }
  return { body: lines.slice(0, end).join("\n").trimEnd(), links };
}

/** The host's side of the same convention: fold links into the prompt text. */
export function appendLinks(text: string, links: string[]): string {
  if (links.length === 0) {
    return text;
  }
  return `${text}\n\n${links.map((link) => `${LINK_MARKER}${link}`).join("\n")}`;
}

/** The host name of a link, for a row title. */
export function linkName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** A stored attachment's `file:` URI as a workspace path, when it has one. */
export function attachmentPath(file: StoredFileAttachment): string | undefined {
  const uri = file.source?.type === "uri" ? file.source.uri : undefined;
  if (!uri || !uri.startsWith("file:")) {
    return undefined;
  }
  try {
    const { pathname } = new URL(uri);
    // The URL parser upper-cases a drive letter ("file:///h:/x" -> "/H:/x").
    // Windows does not care, but the path we show should read like the one
    // the server stored.
    const drive = /^\/*([a-z]):/i.exec(uri.slice("file:".length));
    const withCase =
      drive && /^\/[a-z]:/i.test(pathname)
        ? `/${drive[1]}:${pathname.slice(3)}`
        : pathname;
    // `file:///C:/work` parses to `/C:/work`; a drive letter wants no slash.
    const path = /^\/[a-z]:/i.test(withCase) ? withCase.slice(1) : withCase;
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

/** The line range a selection attachment points at. */
export function attachmentRange(
  file: StoredFileAttachment,
): { start: number; end: number } | undefined {
  const described = file.description?.match(/^L(\d+)-L(\d+)$/);
  if (described) {
    return { start: Number(described[1]), end: Number(described[2]) };
  }
  const uri = file.source?.type === "uri" ? file.source.uri : undefined;
  if (!uri || !uri.includes("?")) {
    return undefined;
  }
  const params = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  const start = Number(params.get("start"));
  const end = Number(params.get("end"));
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }
  return { start, end };
}

function isImage(file: StoredFileAttachment): boolean {
  return file.mime.startsWith("image/") && file.data.length > 0;
}

/**
 * A stored attachment as a renderable row. The server keeps the whole
 * attachment — mime, base64 data, the `file:` URI it came from and the
 * description the host wrote — so the row can name the file, show its
 * range, and open it in the editor.
 */
export function describeAttachment(file: StoredFileAttachment): AttachmentItem {
  const path = attachmentPath(file);
  const range = attachmentRange(file);
  const name = file.name ?? (path ? path.split(/[\\/]/).pop() ?? path : file.mime);

  if (isImage(file)) {
    return {
      kind: "image",
      name,
      detail: path,
      image: `data:${file.mime};base64,${file.data}`,
      mime: file.mime,
      path,
    };
  }

  if (range) {
    return {
      kind: "selection",
      name,
      detail: path ? `L${range.start}-L${range.end} · ${path}` : `L${range.start}-L${range.end}`,
      path,
      start: range.start,
      end: range.end,
    };
  }

  return { kind: "file", name, detail: path, path };
}

/** Every attachment a user message points at, files first and links last. */
export function describeAttachments(
  files: StoredFileAttachment[] | undefined,
  links: string[],
): AttachmentItem[] {
  const items = (files ?? []).map(describeAttachment);
  for (const url of links) {
    items.push({ kind: "url", name: linkName(url), detail: url, url });
  }
  return items;
}

/**
 * What clicking an attachment row does. An image has no place to open — a
 * pasted one only exists as base64 inside the message — so it is previewed
 * instead; a link opens in the browser; a file opens in the editor, at the
 * lines a selection points at.
 */
export type AttachmentTarget =
  | { kind: "preview"; item: AttachmentItem }
  | { kind: "url"; url: string }
  | { kind: "file"; path: string; start?: number; end?: number };

export function attachmentTarget(item: AttachmentItem): AttachmentTarget | undefined {
  if (item.image) {
    return { kind: "preview", item };
  }
  if (item.url) {
    return { kind: "url", url: item.url };
  }
  if (item.path) {
    return { kind: "file", path: item.path, start: item.start, end: item.end };
  }
  return undefined;
}
