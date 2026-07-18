import type { ConversationLoopOutputPhase } from '@shared/types/conversation';

export interface CanonicalAssistantOutputState {
  finalAnswerText: string;
}

export const EMPTY_CANONICAL_ASSISTANT_OUTPUT: CanonicalAssistantOutputState = Object.freeze({
  finalAnswerText: '',
});

export function reduceCanonicalAssistantOutput(
  state: CanonicalAssistantOutputState,
  text: string,
  outputPhase: ConversationLoopOutputPhase | undefined,
): CanonicalAssistantOutputState {
  if (outputPhase !== 'final_answer') return state;
  return { finalAnswerText: text };
}

export function requireCanonicalFinalAnswer(state: CanonicalAssistantOutputState): string {
  const finalAnswer = state.finalAnswerText.trim();
  if (!finalAnswer) {
    throw new Error(
      'PROVIDER_STREAM_MISSING_FINAL_ANSWER: provider completed without a canonical final_answer block.',
    );
  }
  return finalAnswer;
}