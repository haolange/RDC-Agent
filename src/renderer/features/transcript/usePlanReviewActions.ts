import { useI18n } from '../../i18n';
import { useCallback } from 'react';
import type { PlanReadRequest } from '@shared/types/planReview';
import { useElectronApi } from '../../hooks/useElectronApi';

export function usePlanReviewActions() {
  const api = useElectronApi();
  const { t } = useI18n();
  const readPlan = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error(t('chat.planApiUnavailable'));
    return api.plan.read(request);
  }, [api, t]);
  const copyPlan = useCallback(async (markdown: string) => {
    if (!api) throw new Error(t('chat.clipboardUnavailable'));
    await api.appShell.copyText(markdown);
    return true;
  }, [api, t]);
  const saveToProject = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error(t('chat.planApiUnavailable'));
    const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.saveToProject' });
    if (issued.cancelled) return false;
    if (!issued.token) throw new Error(issued.error || t('chat.planSaveApprovalFailed'));
    const result = await api.plan.saveToProject({ ...request, approvalToken: issued.token });
    if (!result.success) throw new Error(result.error || t('chat.planSaveFailed'));
    return true;
  }, [api, t]);
  const exportPlan = useCallback(async (request: PlanReadRequest) => {
    if (!api) throw new Error(t('chat.planApiUnavailable'));
    const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.export' });
    if (issued.cancelled) return false;
    if (!issued.token || !issued.targetPath) throw new Error(issued.error || t('chat.planExportApprovalFailed'));
    const result = await api.plan.export({ ...request, targetPath: issued.targetPath, approvalToken: issued.token });
    if (!result.success) throw new Error(result.error || t('chat.planExportFailed'));
    return true;
  }, [api, t]);
  return { readPlan, copyPlan, saveToProject, exportPlan };
}
