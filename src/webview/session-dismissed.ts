/**
 * Dismissed diff rows belong to the session the user dismissed them in.
 * Switching through the history menu used to clear the panel-wide map, so a
 * file reverted in A reappeared as a ghost row the moment the user came back
 * to A: the server still reports the same historical diff, and nothing
 * remembered the dismissal. Park the outgoing session's map and reload it
 * when the user returns (same pattern as SessionQueues).
 */
export class SessionDismissed {
  private readonly saved = new Map<string, Map<string, string>>();

  /** Park a session's live dismissed map. An empty map erases the parked entry. */
  stash(sessionID: string | undefined, dismissed: Map<string, string>): void {
    if (!sessionID) {
      return;
    }
    if (dismissed.size === 0) {
      this.saved.delete(sessionID);
      return;
    }
    // 克隆驻留：stash 之后 live map 仍会被 dismiss 改写（精神分裂窗口），
    // 驻留副本必须与它脱钩。
    this.saved.set(sessionID, new Map(dismissed));
  }

  /** Load a session's parked map; the parked entry is consumed once. */
  take(sessionID: string | undefined): Map<string, string> {
    if (!sessionID) {
      return new Map();
    }
    const saved = this.saved.get(sessionID);
    if (!saved) {
      return new Map();
    }
    // 取出即删除：stash 已克隆，此后该副本只属于 live 一方，无别名。
    this.saved.delete(sessionID);
    return saved;
  }

  /** Erase a deleted session's parked map so it cannot linger. */
  drop(sessionID: string | undefined): void {
    if (!sessionID) {
      return;
    }
    this.saved.delete(sessionID);
  }
}
