/**
 * ContextManager — 上下文压缩 & 转换。
 *
 * 提供：
 *  - convertToLlm: 默认 AgentMessage → Message 过滤器，
 *    丢弃自定义消息只保留 user/assistant/toolResult。
 *  - compress: 多级压缩管道（toolResultBudget → snipCompact → microCompact → fullCompact），
 *    在保持 tool_use ↔ tool_result 一一对应的前提下，
 *    把超长上下文降到模型可承载的范围内。
 *
 * 该实现专注于纯文本/工具结果的字符级估算，不真实调用 tokenizer。
 * 如未来需要更精确的预算，可以注入自定义 estimator。
 */

import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  Message,
  ProviderReasoningArtifact,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '../core/types';
import { charsToTokens } from '@shared/utils/tokens';
import { TokenizerService } from '../core/TokenizerService';

/** 上下文压缩配置。 */
export interface ContextManagerConfig {
  /** 工具结果最大总字节数。默认 200KB。 */
  toolResultBudget?: number;
  /** 最大消息数（超出时 snip）。默认 50。 */
  maxMessages?: number;
  /** 保留最近的工具结果数量。默认 3。 */
  keepRecentToolResults?: number;
  /** RequestPlan context budget after applying the canonical 80% compaction threshold. */
  contextTokenLimit: number;
  /** 真实 tokenizer 服务（用于精确计数）。 */
  tokenizer?: TokenizerService;
  /** 当前模型 ID（用于选择正确的编码器）。 */
  modelId?: string;
}

const DEFAULT_TOOL_RESULT_BUDGET = 200 * 1024;
const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3;
const SNIP_HEAD = 3;
const TOOL_RESULT_TRUNCATE_HEAD = 2000;

/**
 * 各级压缩写入的占位符前缀，唯一来源。
 * 写入点（snip / micro / full）与读取点（classifyMessages）共享，避免字符串漂移。
 */
export const COMPACTION_MARKERS = {
  snip: '[snipped ',
  toolResult: '[Earlier tool result compacted]',
  summary: '[Conversation summary:',
} as const;

export interface CompressResult {
  messages: AgentMessage[];
  /** 实际发生压缩时的人类可读摘要；no-op 时为 undefined。 */
  summary?: string;
}

/** 上下文管理器。 */
export class ContextManager {
  constructor(private config: ContextManagerConfig) {
    if (!Number.isFinite(config.contextTokenLimit) || config.contextTokenLimit <= 0) {
      throw new Error('ContextManager requires a positive RequestPlan context budget.');
    }
  }

  /**
   * 默认的 convertToLlm 实现：保留三种标准消息。
   */
  convertToLlm(messages: AgentMessage[]): Message[] {
    const result: Message[] = [];
    for (const msg of messages) {
      if (
        msg.role === 'user' ||
        msg.role === 'assistant' ||
        msg.role === 'toolResult'
      ) {
        result.push(msg as Message);
      }
    }
    return result;
  }

  /**
   * 上下文压缩管道（transformContext 实现）。
   * 压缩链路按 budget → snip → micro → full 递进，
   * 每一级都返回新数组，不修改原始数组。
   */
  async compress(
    messages: AgentMessage[],
  ): Promise<CompressResult> {
    const tokenLimit = this.config.contextTokenLimit;
    const beforeCount = messages.length;
    const beforeTokens = this.estimateTokens(messages);
    const stages: string[] = [];

    // Level 1: 工具结果预算控制
    let result = this.toolResultBudget(messages);
    if (!messagesEqual(result, messages)) {
      stages.push('toolResultBudget');
    }

    // Level 2: 消息数过多 → snip 中间
    const afterBudget = result;
    result = this.snipCompact(result);
    if (!messagesEqual(result, afterBudget)) {
      stages.push('snip');
    }

    // Level 3: 早期工具结果 → 占位
    if (this.estimateTokens(result) > tokenLimit) {
      const beforeMicro = result;
      result = this.microCompact(result);
      if (!messagesEqual(result, beforeMicro)) {
        stages.push('micro');
      }
    }

    // Level 4: 仍超限 → 全量摘要
    if (this.estimateTokens(result) > tokenLimit) {
      const beforeFull = result;
      result = await this.fullCompact(result);
      if (!messagesEqual(result, beforeFull)) {
        stages.push('full');
      }
    }

    const semanticStages = stages.filter(
      (stage): stage is 'snip' | 'micro' | 'full' =>
        stage === 'snip' || stage === 'micro' || stage === 'full',
    );
    if (semanticStages.length === 0) {
      return { messages: result };
    }

    const afterCount = result.length;
    const afterTokens = this.estimateTokens(result);
    const removedMessages = Math.max(0, beforeCount - afterCount);
    const summary = removedMessages > 0
      ? `上下文压缩（${semanticStages.join('、')}）：${beforeCount} → ${afterCount} 条消息，约 ${beforeTokens} → ${afterTokens} token`
      : `上下文压缩（${semanticStages.join('、')}）：约 ${beforeTokens} → ${afterTokens} token`;

    return { messages: result, summary };
  }

  /**
   * 将消息数组分为"压缩摘要"和"活跃对话"两组，返回各组的 token 估算与条数。
   *
   * 判断标准：消息内容包含已知的压缩占位符关键词（来自 snipCompact/microCompact/fullCompact）。
   */
  classifyMessages(messages: AgentMessage[]): {
    summaryTokens: number;
    conversationTokens: number;
    conversationCount: number;
  } {
    const summaryPatterns = Object.values(COMPACTION_MARKERS);

    const isSummaryMessage = (msg: AgentMessage): boolean => {
      const content = (msg as { content?: unknown }).content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text) : '')).join('')
          : '';
      return summaryPatterns.some((p) => text.includes(p));
    };

    const summaryMessages: AgentMessage[] = [];
    const conversationMessages: AgentMessage[] = [];
    for (const msg of messages) {
      if (isSummaryMessage(msg)) {
        summaryMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }
    return {
      summaryTokens:      this.estimateTokens(summaryMessages),
      conversationTokens: this.estimateTokens(conversationMessages),
      conversationCount:  conversationMessages.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      ).length,
    };
  }

  /** 估算消息 token 数（优先使用真实 tokenizer）。 */
  estimateTokens(messages: AgentMessage[]): number {
    const tokenizer = this.config.tokenizer;
    const modelId = this.config.modelId;

    if (tokenizer) {
      // 转换为 LLM Message 格式后使用真实 tokenizer 计数
      const llmMessages = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult')
        .map((m) => ({
          role: m.role,
          content: 'content' in m ? (m as { content: unknown }).content : undefined,
        }));
      return tokenizer.countMessagesTokens(llmMessages, modelId);
    }

    // 回退：字符估算
    let chars = 0;
    for (const msg of messages) {
      chars += this.estimateMessageChars(msg);
    }
    return charsToTokens(chars);
  }

  // =====================================================================
  // 各级压缩策略
  // =====================================================================

  /** Level 1: 工具结果预算控制。 */
  private toolResultBudget(messages: AgentMessage[]): AgentMessage[] {
    const budget =
      this.config.toolResultBudget ?? DEFAULT_TOOL_RESULT_BUDGET;

    type Entry = { index: number; size: number };
    const entries: Entry[] = [];
    let totalSize = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'toolResult') {
        const size = this.toolResultSize(msg as ToolResultMessage);
        entries.push({ index: i, size });
        totalSize += size;
      }
    }

    if (totalSize <= budget) {
      return [...messages];
    }

    const result: AgentMessage[] = messages.slice();
    // 按大小从大到小截断，直到总大小回到预算内
    const sorted = [...entries].sort((a, b) => b.size - a.size);
    for (const entry of sorted) {
      if (totalSize <= budget) break;
      const original = result[entry.index] as ToolResultMessage;
      const truncated = this.truncateToolResult(original);
      const newSize = this.toolResultSize(truncated);
      totalSize -= entry.size - newSize;
      result[entry.index] = truncated;
    }
    return result;
  }

  /**
   * Level 2: Snip 压缩（保留头尾，中间替换为占位符）。
   *
   * 不能在 tool_use ↔ tool_result 对中间切断：
   * 如果切口左侧的 assistant 消息含 toolCall，
   * 则把切口往右推一格直到对应的 toolResult 之后。
   */
  private snipCompact(messages: AgentMessage[]): AgentMessage[] {
    const max = this.config.maxMessages ?? DEFAULT_MAX_MESSAGES;
    if (messages.length <= max) {
      return [...messages];
    }

    const head = SNIP_HEAD;
    const tailCount = max - head - 1; // 减去插入的占位符
    if (tailCount <= 0) {
      return [...messages];
    }

    let snipStart = head;
    let snipEnd = messages.length - tailCount; // exclusive

    // 调整 snipStart：如果它指向的位置是某个 assistant.toolCall 的 toolResult，
    // 或者它前一条是含 toolCall 的 assistant，则继续往后推。
    snipStart = this.adjustSnipStart(messages, snipStart);
    snipEnd = this.adjustSnipEnd(messages, snipEnd);

    if (snipStart >= snipEnd) {
      return [...messages];
    }

    const snippedCount = snipEnd - snipStart;
    if (snippedCount <= 0) {
      return [...messages];
    }

    const placeholder: UserMessage = {
      role: 'user',
      content: `${COMPACTION_MARKERS.snip}${snippedCount} messages]`,
      timestamp: Date.now(),
    };

    return [
      ...messages.slice(0, snipStart),
      placeholder,
      ...messages.slice(snipEnd),
    ];
  }

  /** Level 3: Micro 压缩（早期工具结果 → 占位符）。 */
  private microCompact(messages: AgentMessage[]): AgentMessage[] {
    const keep =
      this.config.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS;

    // 找出所有 toolResult 的下标
    const toolResultIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'toolResult') {
        toolResultIndices.push(i);
      }
    }
    if (toolResultIndices.length <= keep) {
      return [...messages];
    }
    const keepFrom = toolResultIndices.length - keep;
    const compactSet = new Set(toolResultIndices.slice(0, keepFrom));

    const result: AgentMessage[] = messages.slice();
    for (const idx of compactSet) {
      const original = result[idx] as ToolResultMessage;
      result[idx] = {
        role: 'toolResult',
        toolCallId: original.toolCallId,
        toolName: original.toolName,
        content: [
          { type: 'text', text: COMPACTION_MARKERS.toolResult },
        ],
        isError: false,
        timestamp: original.timestamp,
      };
    }
    return result;
  }

  /** Level 4: Full 压缩（生成摘要替换全部）。 */
  private async fullCompact(
    messages: AgentMessage[],
  ): Promise<AgentMessage[]> {
    const tail = messages.slice(-5);
    const summary = this.buildSummary(messages.slice(0, -5));
    if (!summary) {
      return [...tail];
    }
    const summaryMsg: UserMessage = {
      role: 'user',
      content: summary,
      timestamp: Date.now(),
    };
    return [summaryMsg, ...tail];
  }

  // =====================================================================
  // 辅助
  // =====================================================================

  private estimateMessageChars(msg: AgentMessage): number {
    if (msg.role === 'user') {
      return this.userContentChars((msg as UserMessage).content);
    }
    if (msg.role === 'assistant') {
      return this.assistantContentChars(msg as AssistantMessage);
    }
    if (msg.role === 'toolResult') {
      return this.toolResultSize(msg as ToolResultMessage);
    }
    // CustomAgentMessage
    try {
      return JSON.stringify(msg).length;
    } catch {
      return 0;
    }
  }

  private userContentChars(
    content: string | (TextContent | ImageContent)[],
  ): number {
    if (typeof content === 'string') {
      return content.length;
    }
    let total = 0;
    for (const block of content) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'image') {
        total += block.data.length;
      }
    }
    return total;
  }

  private assistantContentChars(msg: AssistantMessage): number {
    let total = 0;
    for (const block of msg.content) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'thinking') {
        if (block.replayPolicy === 'provider-artifact' && block.artifact) {
          total += this.providerArtifactChars(block.artifact);
        } else if (block.replayPolicy === 'openai-reasoning-content' && block.text) {
          total += block.text.length;
        }
      } else if (block.type === 'toolCall') {
        const tc = block as ToolCall;
        try {
          total += JSON.stringify(tc.arguments).length + tc.name.length;
        } catch {
          total += tc.name.length;
        }
      }
    }
    return total;
  }

  private providerArtifactChars(artifact: ProviderReasoningArtifact): number {
    try {
      return JSON.stringify(artifact).length;
    } catch {
      return 0;
    }
  }

  private toolResultSize(msg: ToolResultMessage): number {
    let total = 0;
    for (const block of msg.content) {
      if (block.type === 'text') {
        total += block.text.length;
      } else if (block.type === 'image') {
        total += block.data.length;
      }
    }
    return total;
  }

  private truncateToolResult(msg: ToolResultMessage): ToolResultMessage {
    const newContent: (TextContent | ImageContent)[] = [];
    let remaining = TOOL_RESULT_TRUNCATE_HEAD;
    let truncated = false;
    for (const block of msg.content) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (block.type === 'text') {
        if (block.text.length <= remaining) {
          newContent.push({ type: 'text', text: block.text });
          remaining -= block.text.length;
        } else {
          newContent.push({
            type: 'text',
            text: block.text.slice(0, remaining),
          });
          remaining = 0;
          truncated = true;
        }
      } else {
        // 图像内容直接丢弃以释放预算
        truncated = true;
      }
    }
    if (truncated) {
      newContent.push({ type: 'text', text: '... truncated' });
    }
    return {
      role: 'toolResult',
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: newContent,
      isError: msg.isError,
      timestamp: msg.timestamp,
    };
  }

  /**
   * 调整 snipStart：如果该位置正好是某个 toolResult 但其匹配的
   * assistant.toolCall 在 head 之内，则后移到工具对结束之后。
   */
  private adjustSnipStart(messages: AgentMessage[], start: number): number {
    let s = start;
    while (s < messages.length) {
      const msg = messages[s];
      // 如果 s 指向的是 toolResult，需要确认对应 toolCall 的 assistant 是否被截断
      if (msg.role === 'toolResult') {
        s++;
        continue;
      }
      // 如果 s-1 是含 toolCall 的 assistant，但 s 还是其工具结果序列，
      // 由 toolResult 分支推进。
      // 这里 s 指向非 toolResult，可以安全使用。
      // 还要确认 s-1 不是含未消费 toolCall 的 assistant。
      const prev = messages[s - 1];
      if (prev && prev.role === 'assistant') {
        const hasToolCall = (prev as AssistantMessage).content.some(
          (c) => c.type === 'toolCall',
        );
        if (hasToolCall) {
          s++;
          continue;
        }
      }
      break;
    }
    return s;
  }

  /**
   * 调整 snipEnd：保证不在工具调用对中间切断。
   * 如果 snipEnd 指向 toolResult，则前移到对应 assistant.toolCall 之前。
   */
  private adjustSnipEnd(messages: AgentMessage[], end: number): number {
    let e = end;
    while (e > 0 && e < messages.length) {
      const msg = messages[e];
      if (msg.role === 'toolResult') {
        e--;
        continue;
      }
      break;
    }
    return e;
  }

  private buildSummary(messages: AgentMessage[]): string {
    if (messages.length === 0) return '';
    const userCount = messages.filter((m) => m.role === 'user').length;
    const assistantCount = messages.filter(
      (m) => m.role === 'assistant',
    ).length;
    const toolResultCount = messages.filter(
      (m) => m.role === 'toolResult',
    ).length;
    return (
      `${COMPACTION_MARKERS.summary} ${messages.length} earlier messages compacted ` +
      `(user=${userCount}, assistant=${assistantCount}, ` +
      `toolResult=${toolResultCount}). Earlier context omitted to fit window.]`
    );
  }
}

function messagesEqual(left: AgentMessage[], right: AgentMessage[]): boolean {
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
