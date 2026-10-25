import type { ConversationWorkTrace } from '../types/conversation';

/** A plan's actions belong to its review surface, never the assistant result. */
export function hasPlanReviewInteraction(trace: ConversationWorkTrace | null | undefined): boolean {
  return trace?.blocks.some(block => block.kind === 'plan_review'
    || block.toolCalls.some(call => !!call.planReview)) ?? false;
}
