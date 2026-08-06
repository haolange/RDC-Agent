import type { AgentMessage, Message } from '../agent-runtime/core/types';
import type { DerivedContextView } from '@shared/types/semanticContext';
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
  derivedContextView?: DerivedContextView;
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
    toolResultBudget: 200 * 1024,
    keepRecentToolResults: 3,
    tokenizer: tokenizerService,
  });
  const beforeConversationTokens = contextManager.estimateTokens(input.messages)
    + input.imageTokenAdjustment;
  const compacted = await contextManager.compress(input.messages, input.signal);
  const compactedMessages = contextManager.convertToLlm(compacted.messages);
  const afterConversationTokens = contextManager.estimateTokens(compacted.messages)
    + input.imageTokenAdjustment;
  return {
    compactedMessages,
    beforeConversationTokens,
    afterConversationTokens,
    compactionApplied: Boolean(compacted.summary)
      || JSON.stringify(compacted.messages) !== JSON.stringify(input.messages),
    ...(compacted.derivedContextView ? { derivedContextView: compacted.derivedContextView } : {}),
    classification: contextManager.classifyMessages(compacted.messages),
  };
}
