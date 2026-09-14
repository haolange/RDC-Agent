import { useCallback } from 'react';
import type { PlanReadRequest } from '@shared/types/planReview';
import { useElectronApi } from '../../hooks/useElectronApi';

export function usePlanReviewActions() {
  const api = useElectronApi();
  const readPlan = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error('Plan API is not available.');
    return api.plan.read(request);
  }, [api]);
  const copyPlan = useCallback(async (markdown: string) => {
    if (!api) throw new Error('Clipboard API is not available.');
    await api.appShell.copyText(markdown);
    return true;
  }, [api]);
  const saveToProject = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error('Plan API is not available.');
    const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.saveToProject' });
    if (issued.cancelled) return false;
    if (!issued.token) throw new Error(issued.error || 'Unable to authorize saving the plan.');
    const result = await api.plan.saveToProject({ ...request, approvalToken: issued.token });
    if (!result.success) throw new Error(result.error || 'Unable to save the plan.');
    return true;
  }, [api]);
  const exportPlan = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error('Plan API is not available.');
    const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.export' });
    if (issued.cancelled) return false;
    if (!issued.token || !issued.targetPath) throw new Error(issued.error || 'Unable to authorize exporting the plan.');
    const result = await api.plan.export({ ...request, targetPath: issued.targetPath, approvalToken: issued.token });
    if (!result.success) throw new Error(result.error || 'Unable to export the plan.');
    return true;
  }, [api]);
  return { readPlan, copyPlan, saveToProject, exportPlan };
}
