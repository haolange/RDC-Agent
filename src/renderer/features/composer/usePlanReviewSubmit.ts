import { useCallback } from 'react';
import type { PlanReviewDecision } from '@shared/types/planReview';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import { isCurrentPlanReview, usePlanReviewStore } from '../../stores/planReviewStore';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { flushSessionModelSaves } from './sessionModelOverride';
import { loadComposerModelPickerOptions } from './useComposerModelPickerOptions';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';

export const usePlanReviewSubmit = (onReplan?: (payload: { sessionId: string; agentId: string; prompt: string; planSource: import('@shared/types/planReview').PlanReadRequest }) => Promise<unknown>) => {
  const api = useElectronApi();
  return useCallback(async (
  request: PendingPlanReviewRequest,
  decision: PlanReviewDecision,
): Promise<void> => {
  if (!api) {
    throw new Error('Conversation API is not available.');
  }
  const isCurrent = () => useProjectStore.getState().currentSession?.sessionId === request.sessionId
    && isCurrentPlanReview(request, decision.kind);
  let invalidated = !isCurrent();
  if (invalidated) return;
  const invalidate = () => { if (!isCurrent()) invalidated = true; };
  const offSession = useProjectStore.subscribe(invalidate);
  const offConversation = useConversationStore.subscribe(invalidate);
  const offReview = usePlanReviewStore.subscribe(invalidate);
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
    const continuation = decision.kind === 'approve' && request.sessionId ? {
      sessionId: request.sessionId, agentId: decision.handoff.agent, label: decision.handoff.label, prompt: '', send: true,
      sourcePlan: { reviewId: request.reviewId, turnId: request.turnId, toolCallId: request.toolCallId, planId: request.planReview.planId, revision: request.planReview.revision, hash: request.planReview.hash },
    } : null;
    if (continuation) useComposerSessionContextStore.getState().queueHandoffSuggestion({ ...continuation, phase: 'confirming' });
    let result;
    try {
      result = await api.conversation.answerPlanReview({ sessionId: request.sessionId, reviewId: request.reviewId, decision });
    } catch (error) {
      // A lost response may follow a durable approval. Read authority once;
      // never replay the decision or infer permission to execute.
      const current = await api.conversation.getHistory(request.sessionId).catch(() => null);
      if (current?.planReview) usePlanReviewStore.getState().accept(current.planReview);
      throw error;
    }
    if (!result.success) throw new Error(result.error || 'Unable to submit the plan review.');
    if (result.replan && !invalidated && isCurrent()) {
      if (!onReplan) throw new Error('PLAN_REPLAN_UNAVAILABLE');
      await onReplan({ sessionId: request.sessionId, agentId: result.replan.agentId, prompt: result.replan.feedback, planSource: result.replan.source });
    }
    if (!invalidated && isCurrent() && decision.kind === 'approve' && request.sessionId) {
      useComposerSessionContextStore.getState().queueHandoffSuggestion({ ...continuation!, phase: 'handoff' });
    }
  } catch (error) {
    const queued = useComposerSessionContextStore.getState().handoffSuggestionRequest;
    if (queued?.sessionId === request.sessionId && queued.sourcePlan?.toolCallId === request.toolCallId) {
      useComposerSessionContextStore.getState().clearHandoffSuggestion();
    }
    throw error;
  } finally {
    const queued = useComposerSessionContextStore.getState().handoffSuggestionRequest;
    if (queued?.phase === 'confirming' && queued.sessionId === request.sessionId && queued.sourcePlan?.toolCallId === request.toolCallId) {
      useComposerSessionContextStore.getState().clearHandoffSuggestion();
    }
    offSession();
    offConversation();
    offReview();
  }
  }, [api, onReplan]);
};
