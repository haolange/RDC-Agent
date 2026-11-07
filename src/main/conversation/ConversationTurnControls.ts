import type { ConversationTurnControls, ReasoningSelection } from '@shared/types/modelCapability';

/** The current turn's controls override its Agent defaults; neither is inherited by a child. */
export function conversationTurnControlInput(
  agentReasoning: ReasoningSelection | undefined,
  sessionControls: ConversationTurnControls | null | undefined,
  turnControls: ConversationTurnControls | undefined,
): Partial<ConversationTurnControls> {
  return { ...(agentReasoning ? { reasoningLevel: agentReasoning } : {}), ...(sessionControls ?? {}), ...(turnControls ?? {}) };
}

export function assertAgentReasoningHonored(
  agentReasoning: ReasoningSelection | undefined,
  requested: Partial<ConversationTurnControls>,
  actual: ReasoningSelection | 'unknown',
): void {
  if (agentReasoning && requested.reasoningLevel === agentReasoning && actual !== agentReasoning) {
    throw new Error(`CONSTRAINT_REJECTED: The Agent reasoning level ${agentReasoning} is unavailable or unverified for this model. Choose a supported level in Agent settings or Composer.`);
  }
}
