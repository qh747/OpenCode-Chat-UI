/** Which keystroke sends a message from the composer. */
export type SubmitKey = "enter" | "ctrlEnter";

/**
 * Whether this Enter keypress sends the message. `enter` sends on bare Enter
 * (Shift+Enter inserts a newline); `ctrlEnter` sends on Ctrl+Enter — ⌘Enter on
 * macOS, since both modifiers count — leaving plain Enter for a newline.
 * Shift+Enter never sends.
 */
export function shouldSend(
  key: SubmitKey,
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): boolean {
  if (event.shiftKey) {
    return false;
  }
  if (key === "ctrlEnter") {
    return event.ctrlKey || event.metaKey;
  }
  return true;
}
