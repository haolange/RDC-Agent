import type { PlanReviewContext } from '@shared/types/planReview';

export type PendingPlanReviewRequest = PlanReviewContext;
export const planReviewRequestKey = (request: PendingPlanReviewRequest): string =>
  JSON.stringify([request.sessionId, request.reviewId]);
