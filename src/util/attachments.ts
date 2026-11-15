import { pathToFileURL } from "node:url";
import type { PromptFileAttachment } from "../opencode/types";

/** An image held in extension memory until the prompt that carries it is sent. */
export interface StagedImage {
  name: string;
  mime: string;
  data: string;
}

const URI_PATTERN = /^(?:data:|[a-z][a-z0-9+.-]*:\/\/)/i;

/**
 * The prompt API resolves each attachment with `new URL(uri)` and accepts only
 * `data:` and `file:` protocols; anything else fails with "Unsupported
 * attachment URI". Staged images therefore travel inline, and local paths
 * (including Windows drive paths, which `new URL` parses as a custom scheme)
 * are converted to file URLs.
 */
export function attachmentUri(uri: string, staged?: StagedImage): string {
  if (staged) {
    return `data:${staged.mime};base64,${staged.data}`;
  }
  return URI_PATTERN.test(uri) ? uri : pathToFileURL(uri).href;
}

export function promptAttachment(uri: string, staged?: StagedImage): PromptFileAttachment {
  return {
    uri: attachmentUri(uri, staged),
    name: staged?.name ?? basename(uri),
  };
}

/**
 * A selection is a file attachment narrowed to lines: the server reads the
 * optional `?start=&end=` query (1-indexed, inclusive) and sends only that
 * slice, while `description` tells the model where the lines came from.
 */
export function rangeAttachment(
  path: string,
  name: string,
  start: number,
  end: number,
): PromptFileAttachment {
  return {
    uri: `${attachmentUri(path)}?start=${start}&end=${end}`,
    name,
    description: `L${start}-L${end}`,
  };
}

function basename(uri: string): string {
  const normalized = uri.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}
