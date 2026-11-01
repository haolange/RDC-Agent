import { beforeEach, expect, it } from 'vitest';
import { planReviewRequestKey, type PendingPlanReviewRequest } from './planReviewRequestModel';
import { isCurrentPlanReview, usePlanReviewStore } from '../../stores/planReviewStore';
const review = { sessionId: 'session', reviewId: 'attempt', turnId: 'turn', toolCallId: 'call',
  agentId: 'debugger', recovered: true, planReview: { planId: 'plan', revision: 1 } } as PendingPlanReviewRequest;
beforeEach(() => usePlanReviewStore.getState().reset());
it('identifies an approval attempt independently of the stopped source turn', () => {
  usePlanReviewStore.getState().accept({ sessionId: 'session', projectionVersion: 1, review, recoverable: null });
  expect(isCurrentPlanReview(review)).toBe(true);
  expect(planReviewRequestKey(review)).not.toBe(planReviewRequestKey({ ...review, reviewId: 'reopened' }));
  expect(isCurrentPlanReview({ ...review, reviewId: 'expired' })).toBe(false);
});
it('rejects old projections and permits only the matching committed continuation', () => {
  const store = usePlanReviewStore.getState();
  store.accept({ sessionId: 'session', projectionVersion: 2, review: null, recoverable: null,
    decision: { reviewId: 'attempt', kind: 'approve' } });
  store.accept({ sessionId: 'session', projectionVersion: 1, review, recoverable: null });
  expect(isCurrentPlanReview(review)).toBe(false);
  expect(isCurrentPlanReview(review, 'approve')).toBe(true);
  store.accept({ sessionId: 'session', projectionVersion: 3, review: null, recoverable: null });
  expect(isCurrentPlanReview(review, 'approve')).toBe(false);
});
