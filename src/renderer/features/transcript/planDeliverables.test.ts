import { expect, it } from 'vitest';
import { planDeliverables } from './planDeliverables';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview, PlanReviewStatus } from '@shared/types/planReview';

const plan = (planId: string, revision: number, status: PlanReviewStatus): ConversationPlanReview => ({
  planId, revision, status, uri: `session://plans/${planId}.md`, hash: String(revision).repeat(64).slice(0, 64), title: planId,
  summary: [], sections: [], handoffOptions: [],
});
const trace = (...plans: ConversationPlanReview[]): ConversationWorkTrace => ({ status: 'complete', updatedAt: 1, blocks: [{
  id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'complete', startedAt: 1,
  toolCalls: plans.map((planReview, index) => ({ id: `call-${index}`, toolName: 'plan_artifact', status: 'complete', startedAt: 1, planReview })),
}] });

it('delivers each plan once at its latest revision while it is under review or approved', () => {
  expect(planDeliverables(trace(plan('a', 1, 'rejected'), plan('a', 2, 'awaiting'), plan('b', 1, 'approved')))
    .map(({ planId, revision }) => `${planId}:${revision}`)).toEqual(['a:2', 'b:1']);
  expect(planDeliverables(trace(plan('a', 1, 'approved'), plan('a', 2, 'superseded')))).toEqual([]);
  expect(planDeliverables(trace(plan('a', 1, 'cancelled')))).toEqual([]);
  expect(planDeliverables(null)).toEqual([]);
});
