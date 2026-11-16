/**
 * Per-session composer drafts. Content typed (or files attached) in session A
 * must never surface in session B: switching saves the outgoing session's
 * draft into its bucket and restores the incoming session's own bucket, so
 * every draft only ever reappears in the session it belongs to. The
 * "no session yet" state gets its own synthetic bucket ("") so a draft typed
 * before the first message survives session creation. In-memory only —
 * reloading the panel starts every session empty, as before.
 */
export interface ComposerDraft<TChip> {
  text: string;
  chips: TChip[];
}

export class ComposerDraftStore<TChip> {
  private readonly drafts = new Map<string, ComposerDraft<TChip>>();

  /**
   * Complete a session switch: file `draft` under `from` and return the draft
   * bucketed under `to` (taking it out, so the next switch files the live
   * working state back). An unknown target yields an empty draft.
   */
  switch(
    from: string | undefined,
    to: string | undefined,
    draft: ComposerDraft<TChip>,
  ): ComposerDraft<TChip> {
    this.drafts.set(from ?? "", draft);
    const restored = this.drafts.get(to ?? "");
    this.drafts.delete(to ?? "");
    return restored ?? { text: "", chips: [] };
  }

  /** Test/inspection seam: the session ids currently holding a draft. */
  ids(): string[] {
    return [...this.drafts.keys()];
  }
}
