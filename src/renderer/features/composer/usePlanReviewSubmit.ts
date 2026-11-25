import { useCallback } from 'react';
import { AppError } from '@shared/errors/appError';
import { isCurrentPlanReview, usePlanReviewStore } from '../../stores/planReviewStore';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { acceptSessionSnapshot, getSessionView, useSessionRecordStore } from '../../stores/sessionRecordStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { flushSessionModelSaves } from './sessionModelOverride';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import type { ConversationAnswerPlanReviewRequest, PlanReferenceRequest, PlanReviewDecision } from '@shared/types/planReview';

/**
 * Answers a plan review with one call. An approval sends the reviewed hash, the declared handoff, the model and
 * controls shown in the panel and the session revision they were read from; main verifies all of it, runs the handoff
 * hooks and commits the plan, the offer and the session's Agent, model and controls together, or nothing. The
 * committed record and review come back with the declared continuation, which is queued as exactly one execute turn
 * (or prefilled when the declaration does not send).
 */
export const usePlanReviewSubmit = (onReplan?: (payload: { sessionId: string; agentId: string; prompt: string; planReference: PlanReferenceRequest }) => Promise<unknown>) => {
  const api = useElectronApi();
  return useCallback(async (request: PendingPlanReviewRequest, decision: PlanReviewDecision): Promise<void> => {
    if (!api) throw new Error('Conversation API is not available.');
    const isCurrent = () => useProjectStore.getState().currentSessionId === request.sessionId
      && isCurrentPlanReview(request, decision.kind);
    let invalidated = !isCurrent();
    if (invalidated) return;
    const invalidate = () => { if (!isCurrent()) invalidated = true; };
    // Read at each step: a store change can invalidate the request while a call is awaited.
    const live = () => !invalidated && isCurrent();
    const offSession = useProjectStore.subscribe(invalidate);
    const offConversation = useConversationStore.subscribe(invalidate);
    const offReview = usePlanReviewStore.subscribe(invalidate);
    try {
      // Queued model and control edits land first, so the approval is based on the newest record.
      await flushSessionModelSaves(request.sessionId);
      if (!live()) return;
      let answer: ConversationAnswerPlanReviewRequest;
      if (decision.kind === 'approve') {
        const view = getSessionView(request.sessionId);
        const base = useSessionRecordStore.getState().records[request.sessionId];
        const route = resolveComposerEffectiveModel(view?.modelOverride, null,
          readCompiledComposerRoute(useAppSettingsStore.getState().settings, view?.agentId ?? request.agentId));
        if (!base || !route) throw new AppError('MODEL_UNAVAILABLE', 'select an available model before executing the plan.');
        answer = {
          sessionId: request.sessionId, reviewId: request.reviewId, decision,
          expectedPlanHash: request.planReview.hash,
          model: { providerId: route.providerId, modelId: route.modelId },
          controls: { ...useTurnControlsStore.getState().turnControls },
          baseRevision: base.revision,
        };
      } else {
        answer = { sessionId: request.sessionId, reviewId: request.reviewId, decision };
      }
      let result;
      try {
        result = await api.conversation.answerPlanReview(answer);
      } catch (error) {
        // A lost response may follow a durable decision. Read authority once; never replay it or infer an execute.
        const current = await api.conversation.getHistory(request.sessionId).catch(() => null);
        if (current?.planReview) usePlanReviewStore.getState().accept(current.planReview);
        throw error;
      }
      usePlanReviewStore.getState().accept(result.planReview);
      if (result.decision === 'reject') {
        if (result.replan && live()) {
          if (!onReplan) throw new AppError('PLAN_REPLAN_UNAVAILABLE');
          await onReplan({ sessionId: request.sessionId, agentId: result.replan.agentId, prompt: result.replan.feedback,
            planReference: { intent: 'revise', ...result.replan.source } });
        }
        return;
      }
      acceptSessionSnapshot(result.session);
      if (decision.kind !== 'approve' || !live()) return;
      useComposerSessionContextStore.getState().queueHandoffSuggestion({
        sessionId: request.sessionId, agentId: decision.handoff.agent, label: decision.handoff.label,
        prompt: result.handoff.prompt, send: result.handoff.send,
        approval: { reviewId: request.reviewId, planId: request.planReview.planId,
          revision: request.planReview.revision, hash: request.planReview.hash },
      });
    } finally {
      offSession();
      offConversation();
      offReview();
    }
  }, [api, onReplan]);
};
