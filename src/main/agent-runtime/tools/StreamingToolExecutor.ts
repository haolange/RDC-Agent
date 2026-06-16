import type { AgentTool, AgentToolResult } from '../agent/AgentTool';

/**
 * StreamingToolExecutor — 在流式响应期间并行执行只读工具。
 * 当 LLM 正在流式输出时，若遇到只读工具调用，可提前执行并缓存结果，
 * 减少后续等待时间。
 */
export class StreamingToolExecutor {
  private cache = new Map<string, Promise<AgentToolResult>>();

  constructor(private readonly toolPool: { get(name: string): AgentTool | undefined }) {}

  /**
   * 若工具为只读且并发安全，立即启动执行并缓存 Promise。
   * 返回 true 表示已启动，false 表示不满足条件（非只读/不存在）。
   */
  prefetch(toolName: string, toolCallId: string, args: Record<string, unknown>): boolean {
    const tool = this.toolPool.get(toolName);
    if (!tool) return false;
    if (!tool.spec?.isReadOnly || !tool.spec?.isConcurrencySafe) return false;
    const key = `${toolName}:${toolCallId}`;
    if (this.cache.has(key)) return true;
    this.cache.set(key, tool.execute(toolCallId, args as Record<string, unknown>, undefined));
    return true;
  }

  /**
   * 获取已缓存的工具结果。若未缓存或不是只读工具，返回 undefined。
   */
  async consume(toolName: string, toolCallId: string): Promise<AgentToolResult | undefined> {
    const key = `${toolName}:${toolCallId}`;
    const promise = this.cache.get(key);
    if (!promise) return undefined;
    this.cache.delete(key);
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }
}
