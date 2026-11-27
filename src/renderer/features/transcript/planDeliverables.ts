import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';

/**
 * Plans a settled reply delivers: the latest revision of each plan this turn produced, once the person approved it.
 * A plan still under review lives in Working and the Composer gate; earlier, rejected, superseded and cancelled
 * revisions stay as Working rows.
 */
export function planDeliverables(trace: ConversationWorkTrace | null | undefined): ConversationPlanReview[] {
  const latest = new Map<string, ConversationPlanReview>();
  for (const block of trace?.blocks ?? []) {
    for (const call of block.toolCalls) {
      const plan = call.planReview;
      if (!plan) continue;
      const current = latest.get(plan.planId);
      if (!current || plan.revision >= current.revision) latest.set(plan.planId, plan);
    }
  }
  return [...latest.values()].filter((plan) => plan.status === 'approved');
}
