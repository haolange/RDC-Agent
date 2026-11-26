import { useCallback } from 'react';
import { useI18n } from '../../i18n';
import { useElectronApi } from '../../hooks/useElectronApi';
import type { PlanReadRequest } from '@shared/types/planReview';

export function usePlanReviewActions() {
  const api = useElectronApi();
  const { t } = useI18n();
  const readPlan = useCallback(
    async (request: PlanReadRequest) => {
      if (!api) throw new Error(t('chat.planApiUnavailable'));
      return api.plan.read(request);
    },
    [api, t],
  );
  const copyPlan = useCallback(
    async (markdown: string) => {
      if (!api) throw new Error(t('chat.clipboardUnavailable'));
      await api.appShell.copyText(markdown);
      return true;
    },
    [api, t],
  );
  const saveToProject = useCallback(
    async (request: PlanReadRequest) => {
      if (!api) throw new Error(t('chat.planApiUnavailable'));
      const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.saveToProject' });
      if ('cancelled' in issued) return false;
      await api.plan.saveToProject({ ...request, approvalToken: issued.token });
      return true;
    },
    [api, t],
  );
  const exportPlan = useCallback(
    async (request: PlanReadRequest) => {
      if (!api) throw new Error(t('chat.planApiUnavailable'));
      const issued = await api.plan.issueApprovalToken({ ...request, action: 'plan.export' });
      if ('cancelled' in issued) return false;
      await api.plan.export({ ...request, targetPath: issued.targetPath, approvalToken: issued.token });
      return true;
    },
    [api, t],
  );
  return { readPlan, copyPlan, saveToProject, exportPlan };
}
