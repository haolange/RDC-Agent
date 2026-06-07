/**
 * AgentHooks — Agent 生命周期钩子管理器。
 *
 * 设计要点：
 * - 支持注册多个同类型钩子，按注册顺序依次执行（异步串行）。
 * - PreToolUse / UserPromptSubmit 钩子可以返回非空字符串：
 *     · UserPromptSubmit 返回字符串 → 视为对 prompt 的修改/补充（由调用方决定如何使用）。
 *     · PreToolUse 返回字符串 → 阻止工具执行，将该字符串作为错误消息回灌。
 *   只有第一个返回非空字符串的钩子会被采纳，后续钩子仍会执行。
 * - PostToolUse / Stop / ContextCompression 钩子返回 void。
 */

import type { ToolCall, ToolResultMessage, UserMessage } from '../core/types';

// =====================================================================
// 类型
// =====================================================================

/** 钩子事件类型。 */
export type HookEvent =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'ContextCompression';

/** 各钩子的回调签名。 */
export interface HookCallbacks {
  UserPromptSubmit: (
    prompt: string | UserMessage,
  ) => Promise<void | string>;
  /** 返回非空 string 则阻止该工具执行（作为错误消息）。 */
  PreToolUse: (context: {
    toolName: string;
    toolCall: ToolCall;
    turn: number;
  }) => Promise<void | string>;
  PostToolUse: (context: {
    toolName: string;
    toolCall: ToolCall;
    result: ToolResultMessage;
    turn: number;
  }) => Promise<void>;
  Stop: (context: {
    reason: 'completed' | 'max_turns' | 'aborted' | 'error';
    totalTurns: number;
  }) => Promise<void>;
  ContextCompression: (context: {
    currentTokens: number;
    maxTokens: number;
  }) => Promise<void>;
}

type AnyHookCallback = (...args: unknown[]) => Promise<unknown>;

// =====================================================================
// AgentHooks
// =====================================================================

export class AgentHooks {
  private readonly hooks = new Map<HookEvent, AnyHookCallback[]>();

  /**
   * 注册钩子。返回一个用于注销该钩子的函数。
   */
  on<E extends HookEvent>(event: E, callback: HookCallbacks[E]): () => void {
    const list = this.hooks.get(event) ?? [];
    list.push(callback as unknown as AnyHookCallback);
    this.hooks.set(event, list);
    return () => this.off(event, callback);
  }

  /** 注销特定钩子。 */
  off<E extends HookEvent>(event: E, callback: HookCallbacks[E]): void {
    const list = this.hooks.get(event);
    if (!list) return;
    const idx = list.indexOf(callback as unknown as AnyHookCallback);
    if (idx >= 0) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      this.hooks.delete(event);
    }
  }

  /** 清除所有钩子。 */
  clear(): void {
    this.hooks.clear();
  }

  /** 清除特定事件的所有钩子。 */
  clearEvent(event: HookEvent): void {
    this.hooks.delete(event);
  }

  /** 是否有指定事件的钩子。 */
  has(event: HookEvent): boolean {
    const list = this.hooks.get(event);
    return !!list && list.length > 0;
  }

  /**
   * 触发钩子。
   *
   * - 串行执行所有同类型钩子。
   * - 对支持「返回 string 改写/拦截」的事件（UserPromptSubmit / PreToolUse），
   *   仅采纳第一个返回非空字符串的钩子结果，但后续钩子仍会执行（用于副作用）。
   * - 单个钩子抛错不会中止其它钩子，但错误会被收敛后再统一抛出。
   */
  async trigger<E extends HookEvent>(
    event: E,
    ...args: Parameters<HookCallbacks[E]>
  ): Promise<Awaited<ReturnType<HookCallbacks[E]>> | undefined> {
    const list = this.hooks.get(event);
    if (!list || list.length === 0) {
      return undefined;
    }

    let captured: string | undefined;
    const errors: unknown[] = [];

    for (const cb of list) {
      try {
        const ret = await cb(...(args as unknown[]));
        if (
          (event === 'UserPromptSubmit' || event === 'PreToolUse') &&
          typeof ret === 'string' &&
          ret.length > 0 &&
          captured === undefined
        ) {
          captured = ret;
        }
      } catch (err) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      const first = errors[0];
      if (first instanceof Error) {
        throw first;
      }
      throw new Error(`AgentHooks "${event}" 触发时出错: ${String(first)}`);
    }

    return captured as unknown as
      | Awaited<ReturnType<HookCallbacks[E]>>
      | undefined;
  }
}
