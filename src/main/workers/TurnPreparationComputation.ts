import type { AgentMessage, Message } from '../agent-runtime/core/types';
import { ContextManager } from '../agent-runtime/agent/ContextManager';
import { TokenizerService } from '../agent-runtime/core/TokenizerService';

// 进程内共享实例：编码器缓存跨调用复用。
const tokenizerService = new TokenizerService();

export interface TurnPreparationComputationInput {
  messages: AgentMessage[];
  modelId: string;
  messageBudget: number;
  imageTokenAdjustment: number;
  signal?: AbortSignal;
}

export interface TurnPreparationComputationResult {
  compactedMessages: Message[];
  beforeConversationTokens: number;
  afterConversationTokens: number;
  compactionApplied: boolean;
  classification: {
    summaryTokens: number;
    conversationTokens: number;
    conversationCount: number;
  };
}

export async function computeTurnPreparation(
  input: TurnPreparationComputationInput,
): Promise<TurnPreparationComputationResult> {
  const contextManager = new ContextManager({
    modelId: input.modelId,
    contextTokenLimit: input.messageBudget,
    tokenizer: tokenizerService,
  });
  const beforeConversationTokens = contextManager.estimateTokens(input.messages)
    + input.imageTokenAdjustment;
  input.signal?.throwIfAborted();
  // No model call or window installation in the preparation worker.
  const compactedMessages = contextManager.convertToLlm(input.messages);
  const afterConversationTokens = beforeConversationTokens;
  return {
    compactedMessages,
    beforeConversationTokens,
    afterConversationTokens,
    compactionApplied: false,
    classification: contextManager.classifyMessages(input.messages),
  };
}
