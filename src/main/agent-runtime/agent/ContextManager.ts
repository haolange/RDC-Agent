/** Request budgeting and model-window conversion; canonical history is never truncated. */
import type { AgentMessage, AssistantMessage, ImageContent, Message, ProviderContinuationArtifact,
  TextContent, ToolCall, ToolResultMessage, UserMessage } from '../core/types';
import { charsToTokens } from '@shared/utils/tokens';
import { TokenizerService } from '../core/TokenizerService';

export interface ContextManagerConfig {
  contextTokenLimit: number;
  tokenizer?: TokenizerService;
  modelId?: string;
  compact?: (messages: AgentMessage[], signal?: AbortSignal, onProgress?: (progress: import('../core/types').CompactionProgress) => void) => Promise<CompressResult>;
}
export interface CompressResult { messages: AgentMessage[]; summary?: string }
export const estimateImageTokensFromBase64Length = (base64Length: number): number => {
  const byteLength = Math.max(0, Math.floor(base64Length * 0.75));
  return Math.max(256, Math.ceil(byteLength / 1024));
};


export class ContextManager {
  constructor(private config: ContextManagerConfig) {
    if (!Number.isFinite(config.contextTokenLimit) || config.contextTokenLimit <= 0) {
      throw new Error('ContextManager requires a positive RequestPlan context budget.');
    }
  }
  get tokenLimit(): number { return this.config.contextTokenLimit; }
  setRequestTokenLimit(limit: number): void {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('PROMPT_OVERHEAD_EXCEEDS_BUDGET: no conversation budget remains.');
    this.config.contextTokenLimit = limit;
  }
  convertToLlm(messages: AgentMessage[]): Message[] {
    return bridgeToolResultImages(messages.filter((message): message is Message =>
      message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'));
  }
  async compress(messages: AgentMessage[], signal?: AbortSignal, onProgress?: (progress: import('../core/types').CompactionProgress) => void): Promise<CompressResult> {
    signal?.throwIfAborted();
    // The coordinator can reuse a verified window even when canonical history is large.
    if (this.config.compact) {
      const result = await this.config.compact([...messages], signal, onProgress);
      signal?.throwIfAborted();
      if (this.estimateTokens(result.messages) > this.config.contextTokenLimit) {
        throw new Error('CONTEXT_CANNOT_FIT: recoverable context exceeds request budget; original history retained.');
      }
      return result;
    }
    if (this.estimateTokens(messages) > this.config.contextTokenLimit) {
      throw new Error('CONTEXT_CANNOT_FIT: a recoverable compaction service is required; original history retained.');
    }
    return { messages: [...messages] };
  }
  /** Split typed derived context from ordinary conversation without content guessing. */
  classifyMessages(messages: AgentMessage[]): {
    summaryTokens: number;
    conversationTokens: number;
    conversationCount: number;
  } {
    const summaryMessages = messages.filter(
      (message): message is UserMessage =>
        message.role === 'user' && Boolean(message.derivedContext),
    );
    const conversationMessages = messages.filter(
      (message) => !(message.role === 'user' && message.derivedContext),
    );
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
        total += estimateImageTokensFromBase64Length(block.data.length) * 4;
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
        if (block.continuation) total += this.providerArtifactChars(block.continuation);
        else if (block.text) total += block.text.length;
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

  private providerArtifactChars(artifact: ProviderContinuationArtifact): number {
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
        total += estimateImageTokensFromBase64Length(block.data.length) * 4;
      }
    }
    return total;
  }

}

function bridgeToolResultImages(messages: Message[]): Message[] {
  const next: Message[] = [];
  for (const message of messages) {
    if (message.role !== 'toolResult') {
      next.push(message);
      continue;
    }
    const images = message.content.filter((block): block is ImageContent => block.type === 'image' && Boolean(block.data));
    if (images.length === 0) {
      next.push(message);
      continue;
    }
    const textBlocks = message.content.filter((block): block is TextContent => block.type === 'text');
    next.push({
      ...message,
      content: [
        ...textBlocks,
        { type: 'text', text: `[${images.length} image(s) delivered as following user content]` },
      ],
    });
    next.push({
      role: 'user',
      content: [
        { type: 'text', text: `Images from tool ${message.toolName}:` },
        ...images,
      ],
      timestamp: message.timestamp,
    });
  }
  return next;
}
