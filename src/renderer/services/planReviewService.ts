import type { PlanCancelReviewRequest, PlanReadRequest } from '@shared/types/planReview';
import type { ElectronAPI } from '@shared/types/electron';

export async function reopenPlanReview(api: ElectronAPI | undefined, request: PlanReadRequest) {
  if (!api) throw new Error('Plan API is unavailable.');
  return api.plan.reopenReview(request);
}

export async function cancelPlanReview(api: ElectronAPI | undefined, request: PlanCancelReviewRequest) {
  if (!api) throw new Error('Plan API is unavailable.');
  const result = await api.plan.cancelReview(request);
  if (!result.success) throw new Error('Plan review is no longer current.');
}
