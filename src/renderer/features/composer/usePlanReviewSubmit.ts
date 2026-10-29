import { useCallback } from 'react';
import type { PlanReviewDecision } from '@shared/types/planReview';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import { isPlanReviewContinuationCurrent } from './planReviewRequestModel';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { flushSessionModelSaves } from './sessionModelOverride';
import { loadComposerModelPickerOptions } from './useComposerModelPickerOptions';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';

export const usePlanReviewSubmit = () => {
  const api = useElectronApi();
  return useCallback(async (
  request: PendingPlanReviewRequest,
  decision: PlanReviewDecision,
): Promise<void> => {
  if (!api) {
    throw new Error('Conversation API is not available.');
  }
  const isCurrent = () => useProjectStore.getState().currentSession?.sessionId === request.sessionId
    && isPlanReviewContinuationCurrent(useConversationStore.getState().conversationMessages, request);
  let invalidated = !isCurrent();
  if (invalidated) return;
  const invalidate = () => { if (!isCurrent()) invalidated = true; };
  const offSession = useProjectStore.subscribe(invalidate);
  const offConversation = useConversationStore.subscribe(invalidate);
  try {
    const saving = request.sessionId ? flushSessionModelSaves(request.sessionId) : undefined;
    if (saving) await saving;
    if (invalidated || !isCurrent()) return;
    if (decision.kind === 'approve') {
      const settings = useAppSettingsStore.getState().settings;
      const session = useProjectStore.getState().currentSession;
      const route = resolveComposerEffectiveModel(session?.modelOverride, null, readCompiledComposerRoute(settings, decision.handoff.agent));
      const provider = settings.llm.providers.find((item) => item.id === route?.providerId);
      const models = await loadComposerModelPickerOptions(provider ? [provider] : []);
      if (invalidated || !isCurrent()) return;
      const currentProvider = useAppSettingsStore.getState().settings.llm.providers.find((item) => item.id === route?.providerId);
      if (!isProviderExecutable(currentProvider) || currentProvider?.activeAccountId !== provider?.activeAccountId
        || !models.some((model) => model.providerId === route?.providerId && model.modelId === route.modelId)) {
        throw new Error('MODEL_UNAVAILABLE: Please select an available model before executing the plan.');
      }
    }
    const result = await api.conversation.answerPlanReview({
      sessionId: request.sessionId, turnId: request.turnId, toolCallId: request.toolCallId, decision,
    });
    if (!result.success) throw new Error(result.error || 'Unable to submit the plan review.');
    if (!invalidated && isCurrent() && decision.kind === 'approve' && request.sessionId) {
      useComposerSessionContextStore.getState().queueHandoffSuggestion({
        sessionId: request.sessionId, agentId: decision.handoff.agent,
        label: decision.handoff.label, prompt: '', send: true,
        sourcePlan: { turnId: request.turnId, toolCallId: request.toolCallId,
          planId: request.planReview.planId, revision: request.planReview.revision, hash: request.planReview.hash },
      });
    }
  } finally {
    offSession();
    offConversation();
  }
  }, [api]);
};
