/**
 * HandoffMailbox — turn 结束后待 ConversationService 一次性消费的 handoff 请求。
 *
 * TurnHandle.pendingHandoff 在 turn 内写入；turn finally 转入本 mailbox。
 */

import type { PendingHandoff } from './TurnCoordinator';

export type { PendingHandoff };

export class HandoffMailbox {
  private pending: PendingHandoff | null = null;

  deposit(handoff: PendingHandoff): void {
    this.pending = handoff;
  }

  /** 读取并清除（一次性消费）。 */
  consume(): PendingHandoff | null {
    const handoff = this.pending;
    this.pending = null;
    return handoff;
  }

  peek(): PendingHandoff | null {
    return this.pending;
  }

  clear(): void {
    this.pending = null;
  }
}
