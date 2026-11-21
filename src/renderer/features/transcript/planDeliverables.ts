import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';

/**
 * Plans a reply delivers: the latest revision of each plan this turn produced, while it is still the one under
 * review or the one approved. Earlier, rejected, superseded and cancelled revisions stay as Working shell rows.
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
  return [...latest.values()].filter((plan) => plan.status === 'awaiting' || plan.status === 'approved');
}
