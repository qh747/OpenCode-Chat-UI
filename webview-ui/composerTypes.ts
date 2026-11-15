import type { AttachmentKind } from "../src/webview/protocol";

export interface ChipInput {
  path: string;
  name?: string;
  kind?: AttachmentKind;
  /** 1-indexed inclusive lines; selection attachments only. */
  range?: { start: number; end: number };
}

export interface ComposerHandle {
  setChips: (items: ChipInput[]) => void;
}
