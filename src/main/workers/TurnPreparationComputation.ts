import type { AgentMessage, Message } from '../agent-runtime/core/types';
import { ContextManager } from '../agent-runtime/agent/ContextManager';

export interface TurnPreparationComputationInput {
  messages: AgentMessage[];
  modelId: string;
  messageBudget: number;
  imageTokenAdjustment: number;
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
    toolResultBudget: 200 * 1024,
    keepRecentToolResults: 3,
  });
  const beforeConversationTokens = contextManager.estimateTokens(input.messages)
    + input.imageTokenAdjustment;
  const compacted = await contextManager.compress(input.messages);
  const compactedMessages = contextManager.convertToLlm(compacted.messages);
  const afterConversationTokens = contextManager.estimateTokens(compacted.messages)
    + input.imageTokenAdjustment;
  return {
    compactedMessages,
    beforeConversationTokens,
    afterConversationTokens,
    compactionApplied: Boolean(compacted.summary)
      || JSON.stringify(compacted.messages) !== JSON.stringify(input.messages),
    classification: contextManager.classifyMessages(compacted.messages),
  };
}
