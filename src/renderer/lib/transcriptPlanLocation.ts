import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationPlanReference, ConversationPlanReview } from '@shared/types/planReview';

export type PlanRevisionKey = Pick<ConversationPlanReference, 'planId' | 'revision' | 'hash'>;

const samePlan = (left: PlanRevisionKey, right: PlanRevisionKey) =>
  left.planId === right.planId && left.revision === right.revision && left.hash === right.hash;

/** The reviewed revision itself, read from the reply that delivered it. */
export function findPlanReview(messages: readonly ConversationMessage[], plan: PlanRevisionKey): ConversationPlanReview | undefined {
  for (const message of messages) {
    for (const block of message.workTrace?.blocks ?? []) {
      const review = block.toolCalls.find((call) => call.planReview && samePlan(call.planReview, plan))?.planReview;
      if (review) return review;
    }
  }
  return undefined;
}
