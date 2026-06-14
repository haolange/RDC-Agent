/**
 * ForkAgentCompactor — 使用独立子代理执行上下文压缩。
 *
 * 与 ContextManager.compress() 的区别:
 *  - ContextManager: 在主对话中内联执行压缩（规则剪裁 + 摘要）
 *  - ForkAgentCompactor: 启动独立的轻量子代理，LLM 生成高质量摘要
 */
import type { AgentMessage, UserMessage } from '../core/types';

export interface ForkAgentCompactResult {
  summary: string;
  compactedCount: number;
}

export class ForkAgentCompactor {
  /**
   * 使用 LLM 生成压缩摘要。
   *
   * @param messages 待压缩的消息列表
   * @param providerCall LLM 调用函数（由调用方注入，避免循环依赖）
   * @returns 摘要文本
   */
  async compact(
    messages: AgentMessage[],
    providerCall: (prompt: string) => Promise<string>,
  ): Promise<ForkAgentCompactResult> {
    const userMessages = messages.filter((m) => m.role === 'user').length;
    const assistantMessages = messages.filter((m) => m.role === 'assistant').length;
    const toolMessages = messages.filter((m) => m.role === 'toolResult').length;

    const prompt = [
      'You are a context compression assistant. Summarize the following conversation into a concise but complete summary.',
      '',
      `Stats: ${userMessages} user messages, ${assistantMessages} assistant responses, ${toolMessages} tool results.`,
      '',
      'Include in your summary:',
      '- Key decisions made',
      '- Files modified and why',
      '- Errors encountered and how they were resolved',
      '- Current task state and next steps',
      '',
      'Output ONLY the summary text (no markdown headings, no JSON).',
    ].join('\n');

    const summary = await providerCall(prompt);

    return {
      summary: summary.slice(0, 4000), // 限制摘要长度
      compactedCount: messages.length,
    };
  }

  /** 将压缩结果格式化为 UserMessage 插入上下文。 */
  toSummaryMessage(result: ForkAgentCompactResult): UserMessage {
    return {
      role: 'user',
      content: `[Context compacted: ${result.compactedCount} earlier messages summarized]\n\n${result.summary}`,
      timestamp: Date.now(),
    };
  }
}
