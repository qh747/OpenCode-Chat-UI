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
 * Queued messages belong to the session they were typed in. Switching through
 * the history menu used to call `resetQueue()` only, so A's waiting messages
 * were dropped — and a message the user queued while A was busy never got sent
 * once the turn ended in the background. Stash the outgoing session's queue and
 * reload it (then drain it if the session is idle) when the user comes back.
 */
export class SessionQueues {
  private readonly saved = new Map<string, QueueSnapshot>();

  stash(sessionID: string | undefined, snapshot: QueueSnapshot): void {
    if (!sessionID) {
      return;
    }
    if (snapshot.items.length === 0 && !snapshot.pendingForce) {
      this.saved.delete(sessionID);
      return;
    }
    // 克隆驻留：snapshot.items 通常就是 live 数组（stashQueue 的默认参数），
    // 精神分裂窗口内的原地 push 不得写进驻留快照（issue 04c）。
    this.saved.set(sessionID, cloneSnapshot(snapshot));
  }

  take(sessionID: string | undefined): QueueSnapshot {
    if (!sessionID) {
      // 空泊位必须返回全新字面量:模块级 EMPTY 的 items 是共享数组,
      // 原样返回会让 live 队列别名它,排队 push 写进所有"空"队列(issue 05)。
      return { items: [], paused: false };
    }
    const snapshot = this.saved.get(sessionID);
    if (!snapshot) {
      return { items: [], paused: false };
    }
    // 取出即删除 + 克隆：驻留条目只消费一次，live 队列与驻留快照不再别名。
    this.saved.delete(sessionID);
    return cloneSnapshot(snapshot);
  }

  drop(sessionID: string | undefined): QueueSnapshot | undefined {
    if (!sessionID) {
      return undefined;
    }
    const snapshot = this.saved.get(sessionID);
    this.saved.delete(sessionID);
    return snapshot;
  }
}
