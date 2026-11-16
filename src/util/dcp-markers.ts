/**
 * The `@tarquinen/opencode-dcp` plugin tags every message in the conversation
 * with an id the model can reference later — `@14@` in its compact format,
 * `@b3@` for a compressed block, or `<dcp-message-id>m0014</dcp-message-id>`
 * in its XML format. The model sometimes echoes that tag at the end of a
 * reply, where it reads like noise.
 *
 * The transcript strips the tags from the end of the text it renders. Tags in
 * the middle are left alone: there they may be a real reference to another
 * message, which is what the plugin put them there for.
 */

/**
 * A tag in trailing position: a compact id (optionally with a priority
 * label) or the XML form, followed only by whitespace to the end of the
 * text. Since 2026-11 the tag may sit right after the last sentence —
 * models echo it glued to the final period, not always on its own line.
 * Mid-text tags still stay: there they read as a real reference.
 */
const TRAILING_TAG =
  /(?:@(?:b\d+|\d+)@(?:\s*\[[^\]\n]*\])?|<dcp-message-id[^>]*>[^<]*<\/dcp-message-id>)[ \t]*\s*$/;

export function stripTrailingMarkers(text: string): string {
  let current = text;
  while (TRAILING_TAG.test(current)) {
    current = current.replace(TRAILING_TAG, "");
  }
  return current.trimEnd();
}
