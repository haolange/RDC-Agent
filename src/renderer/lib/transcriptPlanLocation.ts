import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationPlanReference } from '@shared/types/planReview';

/** Internal request between a plan card and the user message that executes or revises that plan revision. */
export const TRANSCRIPT_LOCATE_PLAN_EVENT = 'transcript-locate-plan';

export type PlanRevisionKey = Pick<ConversationPlanReference, 'planId' | 'revision' | 'hash'>;

export interface TranscriptPlanLocationRequest {
  target: 'plan' | 'reference';
  plan: PlanRevisionKey;
}

const samePlan = (left: PlanRevisionKey, right: PlanRevisionKey) =>
  left.planId === right.planId && left.revision === right.revision && left.hash === right.hash;

/** Index of the message holding the requested plan card or plan-referencing user message, or -1. */
export function findPlanLocation(messages: readonly ConversationMessage[], request: TranscriptPlanLocationRequest): number {
  return request.target === 'reference'
    ? messages.findIndex((message) => message.role === 'user' && !!message.planReference && samePlan(message.planReference, request.plan))
    : messages.findIndex((message) => (message.workTrace?.blocks ?? []).some((block) => block.toolCalls.some((call) =>
      call.planReview && samePlan(call.planReview, request.plan))));
}

export function requestPlanLocation(request: TranscriptPlanLocationRequest): void {
  document.dispatchEvent(new CustomEvent<TranscriptPlanLocationRequest>(TRANSCRIPT_LOCATE_PLAN_EVENT, { detail: request }));
}
