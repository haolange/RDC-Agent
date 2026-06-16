import type { AgentMessage } from '../core/types';

interface AutoCompactThresholds {
  soft: number;   // 触发警告
  medium: number; // 触发轻量压缩
  hard: number;   // 触发全量压缩
}

/**
 * AutoCompactor — 三阈值自动压缩触发引擎。
 * 根据当前上下文 token 数与阈值的比较，决定压缩策略。
 */
export class AutoCompactor {
  private thresholds: AutoCompactThresholds;

  constructor(thresholds?: Partial<AutoCompactThresholds>) {
    this.thresholds = {
      soft: thresholds?.soft ?? 0.6,
      medium: thresholds?.medium ?? 0.75,
      hard: thresholds?.hard ?? 0.9,
    };
  }

  /**
   * 检查当前上下文比例，返回建议的压缩级别。
   * @param currentTokens 当前 token 数
   * @param maxTokens 最大 token 预算
   * @returns 'none' | 'warn' | 'light' | 'full'
   */
  check(currentTokens: number, maxTokens: number): 'none' | 'warn' | 'light' | 'full' {
    const ratio = maxTokens > 0 ? currentTokens / maxTokens : 0;
    if (ratio >= this.thresholds.hard) return 'full';
    if (ratio >= this.thresholds.medium) return 'light';
    if (ratio >= this.thresholds.soft) return 'warn';
    return 'none';
  }

  /**
   * 根据压缩级别执行对应的压缩策略。
   * light: 仅截断早期工具结果
   * full: 保留最近 5 条消息，其余生成摘要
   */
  async compact(
    messages: AgentMessage[],
    level: 'light' | 'full',
    estimator: (msgs: AgentMessage[]) => number,
  ): Promise<AgentMessage[]> {
    if (level === 'light') {
      return this.lightCompact(messages);
    }
    return this.fullCompact(messages, estimator);
  }

  private lightCompact(messages: AgentMessage[]): AgentMessage[] {
    // 仅将早期 toolResult 替换为占位符
    const result = messages.slice();
    let compacted = 0;
    for (let i = 0; i < result.length && compacted < 3; i++) {
      if (result[i].role === 'toolResult') {
        result[i] = {
          ...result[i],
          content: [{ type: 'text', text: '[Earlier tool result compacted]' }],
        } as AgentMessage;
        compacted++;
      }
    }
    return result;
  }

  private async fullCompact(
    messages: AgentMessage[],
    estimator: (msgs: AgentMessage[]) => number,
  ): Promise<AgentMessage[]> {
    const tail = messages.slice(-5);
    const head = messages.slice(0, -5);
    const summary: AgentMessage = {
      role: 'user',
      content: `[Conversation summary: ${head.length} earlier messages compacted to fit context window.]`,
      timestamp: Date.now(),
    };
    const result = [summary, ...tail];
    // 如果仍然超限，继续截断
    if (estimator(result) > estimator(messages) * 0.5) {
      return tail.length > 0 ? tail : messages.slice(-2);
    }
    return result;
  }
}
