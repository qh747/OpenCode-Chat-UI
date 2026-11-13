/**
 * Unified diff utilities: parse a git-style unified diff and reconstruct the
 * "before" content by reverse-applying hunks onto the current file content.
 * Used to open native VS Code diff editors and to revert single files without
 * relying on server-side revert APIs.
 */

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ParsedPatch {
  hunks: Hunk[];
}

/**
 * Parse the hunk headers and lines of a unified diff. Tolerates `diff --git`
 * headers, `index`/`---`/`+++` lines and no-newline-at-eof markers.
 */
export function parsePatch(patch: string): ParsedPatch {
  const lines = patch.split("\n");
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of lines) {
    const match = header.exec(line);
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      continue; // file-level headers
    }
    if (line === "") {
      continue; // trailing-newline artifact, not a real context line
    }
    if (line.startsWith(" ")) {
      current.lines.push(line);
    } else if (line.startsWith("+") || line.startsWith("-")) {
      current.lines.push(line);
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — ignored for content reconstruction
    }
  }
  return { hunks };
}

/**
 * Reconstruct the pre-image by reverse-applying the patch onto `after`.
 * Hunks are applied bottom-up so earlier offsets stay valid. Throws when the
 * patch does not match the current content (stale patch).
 */
export function reverseApply(after: string, patch: string): string {
  const { hunks } = parsePatch(patch);
  const eol = after.includes("\r\n") ? "\r\n" : "\n";
  const lines = after === "" ? [] : after.split(/\r?\n/);
  const hadTrailingNewline = after.endsWith("\n");
  if (hadTrailingNewline) {
    lines.pop(); // drop empty element produced by the trailing newline
  }

  for (let h = hunks.length - 1; h >= 0; h -= 1) {
    const hunk = hunks[h];
    if (hunk) {
      applyHunkReverse(lines, hunk);
    }
  }
  return lines.join(eol);
}

function applyHunkReverse(content: string[], hunk: Hunk): void {
  const afterSeq: string[] = []; // how the hunk region looks in the current (new) file
  const beforeSeq: string[] = []; // how it looked before the change
  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      afterSeq.push(line.slice(1));
    } else if (line.startsWith("-")) {
      beforeSeq.push(line.slice(1));
    } else {
      const text = line.slice(1);
      beforeSeq.push(text);
      afterSeq.push(text);
    }
  }

  // Anchor: 0-based index where the after-region starts in the current file.
  const anchor = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;

  // Verify, with a small search window to absorb slightly stale offsets.
  const offsets = [0, -1, 1, -2, 2, -3, 3];
  for (const offset of offsets) {
    const start = anchor + offset;
    if (start < 0 || start + afterSeq.length > content.length) {
      continue;
    }
    let matches = true;
    for (let i = 0; i < afterSeq.length; i += 1) {
      if (content[start + i] !== afterSeq[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    content.splice(start, afterSeq.length, ...beforeSeq);
    return;
  }
  throw new Error(`patch does not match current content (hunk @${hunk.newStart})`);
}
