import type { QueuedMessage } from "./protocol";

export interface QueueSnapshot {
  items: QueuedMessage[];
  paused: boolean;
  pendingForce?: QueuedMessage;
}

/** 深拷贝快照（items/pendingForce 各自克隆），无 pendingForce 时省略该键。 */
function cloneSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
  return snapshot.pendingForce
    ? {
        items: [...snapshot.items],
        paused: snapshot.paused,
        pendingForce: { ...snapshot.pendingForce },
      }
    : { items: [...snapshot.items], paused: snapshot.paused };
}

/**
 * Queue state belongs to the session it was typed in and lives only here,
 * keyed by session (spec Q19). The panel's live queue is a read-view of the
 * current session; every send path carries its owning session explicitly, so
 * a message queued while A was busy is delivered to A even when the user is
 * looking at B. Methods hand out copies — callers mutate only through the
 * API, never by holding an internal array reference.
 */
export class SessionQueues {
  private readonly states = new Map<string, QueueSnapshot>();

  /** The keyed entry, created on demand so callers never see undefined. */
  private entry(sessionID: string): QueueSnapshot {
    let state = this.states.get(sessionID);
    if (!state) {
      state = { items: [], paused: false };
      this.states.set(sessionID, state);
    }
    return state;
  }

  /** 无消息且无强制位的状态没有记忆价值:归一化删除,读侧回归空字面量。 */
  private normalize(sessionID: string): void {
    const state = this.states.get(sessionID);
    if (state && state.items.length === 0 && !state.pendingForce) {
      this.states.delete(sessionID);
    }
  }

  /** Read a session's queue state as a fresh copy; unknown sessions read empty. */
  state(sessionID: string | undefined): QueueSnapshot {
    if (!sessionID) {
      // 空读必须返回全新字面量:模块级共享数组曾让"空"队列别名同一本体
      // (issue 05)。
      return { items: [], paused: false };
    }
    const state = this.states.get(sessionID);
    if (!state) {
      return { items: [], paused: false };
    }
    return cloneSnapshot(state);
  }

  push(sessionID: string, item: QueuedMessage): void {
    this.entry(sessionID).items.push(item);
  }

  unshift(sessionID: string, item: QueuedMessage): void {
    this.entry(sessionID).items.unshift(item);
  }

  shift(sessionID: string): QueuedMessage | undefined {
    const state = this.entry(sessionID);
    const head = state.items.shift();
    this.normalize(sessionID);
    return head;
  }

  remove(sessionID: string, id: string): QueuedMessage | undefined {
    const state = this.entry(sessionID);
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return undefined;
    }
    const removed = state.items.splice(index, 1)[0];
    this.normalize(sessionID);
    return removed;
  }

  setPaused(sessionID: string, paused: boolean): void {
    this.entry(sessionID).paused = paused;
    this.normalize(sessionID);
  }

  setPendingForce(sessionID: string, item: QueuedMessage | undefined): void {
    this.entry(sessionID).pendingForce = item;
    this.normalize(sessionID);
  }

  /** Erase a deleted session's queue state; returns it for attachment cleanup. */
  drop(sessionID: string | undefined): QueueSnapshot | undefined {
    if (!sessionID) {
      return undefined;
    }
    const snapshot = this.states.get(sessionID);
    this.states.delete(sessionID);
    return snapshot;
  }
}
