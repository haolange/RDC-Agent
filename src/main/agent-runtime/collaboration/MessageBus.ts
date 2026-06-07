/**
 * MessageBus — Agent 间通信总线。
 *
 * 参考 JSONL 邮箱模式，为每个注册的 Agent 维护独立收件箱。
 * 支持两种消费模式：
 * - Polling：readInbox / peekInbox 主动拉取；
 * - Push：onMessage 注册实时监听器。
 */

import { randomUUID } from 'node:crypto';

/** 总线消息结构。 */
export interface BusMessage {
  /** 消息唯一 id。 */
  id: string;
  /** 发送方 Agent id。 */
  from: string;
  /** 接收方 Agent id（broadcast 时为 '*'）。 */
  to: string;
  /** 消息类型。 */
  type: 'message' | 'request' | 'response' | 'broadcast';
  /** 消息载荷。 */
  payload: unknown;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
  /** 请求-响应配对 id。 */
  correlationId?: string;
}

/** 实时消息监听器签名。 */
export type MessageHandler = (msg: BusMessage) => void;

/**
 * Agent 间通信总线。
 *
 * 内部使用 Map 存储每个 Agent 的邮箱及监听器集合。
 */
export class MessageBus {
  /** 邮箱：agentId → 待读取消息队列。 */
  private readonly mailboxes = new Map<string, BusMessage[]>();
  /** 实时监听器：agentId → handler 集合。 */
  private readonly listeners = new Map<string, Set<MessageHandler>>();

  /** 注册 Agent 到总线（创建邮箱）。 */
  register(agentId: string): void {
    if (!this.mailboxes.has(agentId)) {
      this.mailboxes.set(agentId, []);
      this.listeners.set(agentId, new Set());
    }
  }

  /** 注销 Agent（移除邮箱和监听器）。 */
  unregister(agentId: string): void {
    this.mailboxes.delete(agentId);
    this.listeners.delete(agentId);
  }

  /** 发送消息给指定 Agent，返回消息 id。 */
  send(from: string, to: string, payload: unknown): string {
    const msg: BusMessage = {
      id: randomUUID(),
      from,
      to,
      type: 'message',
      payload,
      timestamp: Date.now(),
    };
    this.deliver(to, msg);
    return msg.id;
  }

  /** 广播消息给所有已注册的 Agent（除发送者自身）。 */
  broadcast(from: string, payload: unknown): void {
    const msg: BusMessage = {
      id: randomUUID(),
      from,
      to: '*',
      type: 'broadcast',
      payload,
      timestamp: Date.now(),
    };
    for (const agentId of this.mailboxes.keys()) {
      if (agentId !== from) {
        this.deliver(agentId, msg);
      }
    }
  }

  /** 读取并清空指定 Agent 的收件箱。 */
  readInbox(agentId: string): BusMessage[] {
    const inbox = this.mailboxes.get(agentId);
    if (!inbox || inbox.length === 0) {
      return [];
    }
    const messages = [...inbox];
    inbox.length = 0;
    return messages;
  }

  /** 查看但不清空指定 Agent 的收件箱。 */
  peekInbox(agentId: string): BusMessage[] {
    const inbox = this.mailboxes.get(agentId);
    return inbox ? [...inbox] : [];
  }

  /** 注册实时消息监听器，返回取消订阅函数。 */
  onMessage(agentId: string, handler: MessageHandler): () => void {
    let handlerSet = this.listeners.get(agentId);
    if (!handlerSet) {
      handlerSet = new Set();
      this.listeners.set(agentId, handlerSet);
    }
    handlerSet.add(handler);
    return () => {
      handlerSet!.delete(handler);
    };
  }

  /**
   * 发送带类型和 correlationId 的底层消息（供 TeamProtocol 使用）。
   * 返回消息 id。
   */
  sendRaw(msg: Omit<BusMessage, 'id' | 'timestamp'>): string {
    const full: BusMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.deliver(full.to, full);
    return full.id;
  }

  /** 投递消息到目标邮箱并通知实时监听器。 */
  private deliver(agentId: string, msg: BusMessage): void {
    const inbox = this.mailboxes.get(agentId);
    if (inbox) {
      inbox.push(msg);
    }
    const handlers = this.listeners.get(agentId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(msg);
        } catch {
          // 监听器异常不应影响总线运行
        }
      }
    }
  }
}
