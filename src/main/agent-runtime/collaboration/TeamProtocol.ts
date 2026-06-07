/**
 * TeamProtocol — 高级请求-应答协议。
 *
 * 在 MessageBus 之上构建结构化的请求/响应语义，
 * 支持超时控制、计划审批、用户输入中转等团队协作场景。
 */

import { randomUUID } from 'node:crypto';
import { MessageBus, type BusMessage } from './MessageBus';

/** 默认请求超时（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 团队协作协议层。
 *
 * 基于 MessageBus 提供带 correlationId 的请求-响应模式，
 * 以及面向 Agent 协作的高层操作（askUser、submitPlan、shutdown）。
 */
export class TeamProtocol {
  /** 待处理的 pending response 回调：correlationId → resolve/reject。 */
  private readonly pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly bus: MessageBus) {}

  /**
   * 发送请求并等待对应 correlationId 的响应。
   *
   * 超时后 Promise 将被 reject 并标记为 expired。
   */
  request(from: string, to: string, action: string, data?: unknown): Promise<unknown> {
    const correlationId = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`TeamProtocol.request timeout: action="${action}" from="${from}" to="${to}" (${DEFAULT_TIMEOUT_MS}ms)`));
      }, DEFAULT_TIMEOUT_MS);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      // 通过总线发送 request 类型消息
      this.bus.sendRaw({
        from,
        to,
        type: 'request',
        payload: { action, data },
        correlationId,
      });
    });
  }

  /**
   * 响应一个请求消息。
   *
   * 使用原始消息的 correlationId 发送 response 类型消息。
   */
  respond(originalMsg: BusMessage, result: unknown): void {
    if (!originalMsg.correlationId) {
      return;
    }
    this.bus.sendRaw({
      from: originalMsg.to === '*' ? '__protocol__' : originalMsg.to,
      to: originalMsg.from,
      type: 'response',
      payload: result,
      correlationId: originalMsg.correlationId,
    });
  }

  /**
   * 子 Agent 请求用户输入（通过主 Agent 中转）。
   *
   * 发送给 id 为 'main' 的主 Agent，由其代理用户回复。
   */
  askUser(agentId: string, question: string): Promise<string> {
    return this.request(agentId, 'main', 'ask_user', { question }) as Promise<string>;
  }

  /**
   * 提交计划审批请求。
   *
   * 发送给主 Agent，等待返回审批结果。
   */
  submitPlan(agentId: string, plan: string): Promise<'approved' | 'rejected' | 'revised'> {
    return this.request(agentId, 'main', 'submit_plan', { plan }) as Promise<'approved' | 'rejected' | 'revised'>;
  }

  /** 发送 shutdown 信号给指定 Agent。 */
  shutdown(agentId: string): void {
    this.bus.sendRaw({
      from: 'main',
      to: agentId,
      type: 'message',
      payload: { action: 'shutdown' },
    });
  }

  /**
   * 处理收到的 response 消息（应在消息监听器中调用）。
   *
   * 将匹配到 correlationId 的 pending request resolve。
   */
  handleResponse(msg: BusMessage): boolean {
    if (msg.type !== 'response' || !msg.correlationId) {
      return false;
    }
    const pending = this.pendingRequests.get(msg.correlationId);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.correlationId);
    pending.resolve(msg.payload);
    return true;
  }

  /**
   * 为指定 Agent 安装 response 自动处理监听器。
   *
   * 返回取消订阅函数。当该 Agent 收到 response 类型消息时自动 resolve pending requests。
   */
  installResponseHandler(agentId: string): () => void {
    return this.bus.onMessage(agentId, (msg) => {
      this.handleResponse(msg);
    });
  }

  /** 清理所有 pending 请求（全部 reject）。 */
  dispose(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('TeamProtocol disposed'));
    }
    this.pendingRequests.clear();
  }
}
