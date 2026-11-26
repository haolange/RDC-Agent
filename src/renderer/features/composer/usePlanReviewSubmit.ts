import { useCallback } from 'react';
import { AppError } from '@shared/errors/appError';
import { isCurrentPlanReview, usePlanReviewStore } from '../../stores/planReviewStore';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useSessionStore } from '../../stores/sessionStore';
import { acceptSessionSnapshot, getSessionView, useSessionRecordStore } from '../../stores/sessionRecordStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from '../../lib/composerEffectiveModel';
import { flushSessionModelSaves } from './sessionModelOverride';
import { isComposerExecutionIdle } from './composerTurnIdle';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import type { ComposerSendOutcome, HandoffSendPayload } from './composerHandoffSend';
import type { ConversationAnswerPlanReviewRequest, PlanReviewDecision } from '@shared/types/planReview';

/** How an answered review continues in the Composer: a replan or execute turn is sent, a non-sending one prefilled. */
export interface PlanReviewContinuation {
  send: (payload: HandoffSendPayload) => Promise<ComposerSendOutcome | undefined>;
  prefill: (prompt: string) => void;
}

/**
 * The owning turn is still running when it asks for review. Resolves true once it and every other turn has ended, or
 * false as soon as the decision stops being the current one.
 */
function untilTurnIdle(live: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const offs: Array<() => void> = [];
    let settled = false;
    const check = () => {
      if (settled) return;
      const outcome = !live() ? false : isComposerExecutionIdle() ? true : null;
      if (outcome === null) return;
      settled = true;
      offs.forEach((off) => off());
      resolve(outcome);
    };
    offs.push(
      useComposerSessionContextStore.subscribe(check),
      useConversationStore.subscribe(check),
      useSessionStore.subscribe(check),
    );
    check();
  });
}

/**
 * Answers a plan review with one call. An approval sends the reviewed hash, the declared handoff, the model and
 * controls shown in the panel and the session revision they were read from; main verifies all of it, runs the handoff
 * hooks and commits the plan, the offer and the session's Agent, model and controls together, or nothing. The
 * committed record and review come back with the declared continuation: once the owning turn has ended it is sent as
 * exactly one execute turn, or prefilled when the declaration does not send. A send main does not accept leaves the
 * approved plan unsent, which main projects as the explicit continuation row (`ApprovedPlanHandoff`).
 */
export const usePlanReviewSubmit = (continuation: PlanReviewContinuation) => {
  const api = useElectronApi();
  return useCallback(
    async (request: PendingPlanReviewRequest, decision: PlanReviewDecision): Promise<void> => {
      if (!api) throw new Error('Conversation API is not available.');
      const isCurrent = () =>
        useProjectStore.getState().currentSessionId === request.sessionId &&
        isCurrentPlanReview(request, decision.kind);
      let invalidated = !isCurrent();
      if (invalidated) return;
      const invalidate = () => {
        if (!isCurrent()) invalidated = true;
      };
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
          const route = resolveComposerEffectiveModel(
            view?.modelOverride,
            null,
            readCompiledComposerRoute(useAppSettingsStore.getState().settings, view?.agentId ?? request.agentId),
          );
          if (!base || !route)
            throw new AppError('MODEL_UNAVAILABLE', 'select an available model before executing the plan.');
          answer = {
            sessionId: request.sessionId,
            reviewId: request.reviewId,
            decision,
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
            await continuation.send({
              sessionId: request.sessionId,
              agentId: result.replan.agentId,
              prompt: result.replan.feedback,
              planReference: { intent: 'revise', ...result.replan.source },
            });
          }
          return;
        }
        acceptSessionSnapshot(result.session);
        if (decision.kind !== 'approve' || !live()) return;
        if (!result.handoff.send) {
          continuation.prefill(result.handoff.prompt);
          return;
        }
        if (!(await untilTurnIdle(live))) return;
        await continuation.send({
          sessionId: request.sessionId,
          agentId: decision.handoff.agent,
          prompt: result.handoff.prompt,
          planReference: {
            intent: 'execute',
            sessionId: request.sessionId,
            planId: request.planReview.planId,
            revision: request.planReview.revision,
            expectedHash: request.planReview.hash,
          },
        });
      } finally {
        offSession();
        offConversation();
        offReview();
      }
    },
    [api, continuation],
  );
};
