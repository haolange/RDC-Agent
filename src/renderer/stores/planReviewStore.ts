import { create } from 'zustand';
import type { PlanReviewContext, PlanReviewProjection } from '@shared/types/planReview';

interface PlanReviewState {
  bySession: Record<string, PlanReviewProjection>;
  accept: (projection: PlanReviewProjection) => void;
  reset: () => void;
}

export const usePlanReviewStore = create<PlanReviewState>((set) => ({
  bySession: {},
  accept: projection => set(state => {
    const current = state.bySession[projection.sessionId];
    if (current && current.projectionVersion > projection.projectionVersion) return state;
    return { bySession: { ...state.bySession, [projection.sessionId]: projection } };
  }),
  reset: () => set({ bySession: {} }),
}));

export function isCurrentPlanReview(request: Pick<PlanReviewContext, 'sessionId' | 'reviewId'>, decision?: 'approve' | 'reject'): boolean {
  const head = usePlanReviewStore.getState().bySession[request.sessionId];
  return head?.review?.reviewId === request.reviewId
    || (!!decision && head?.decision?.reviewId === request.reviewId && head.decision.kind === decision);
}
