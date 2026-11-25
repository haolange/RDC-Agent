import { useEffect, useRef, useState } from 'react';
import { isCurrentPlanReview, usePlanReviewStore } from '../../stores/planReviewStore';
import { useComposerSessionContextStore, type HandoffSuggestionRequest } from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';
import { applyDeclaredHandoffOnClient } from './sessionAgentId';
import type { ComposerSendOutcome, HandoffSendPayload } from './composerHandoffSend';

interface Delivery {
  request: HandoffSuggestionRequest;
  payload: HandoffSendPayload;
  error?: string;
  outcome?: ComposerSendOutcome;
  switchFailed?: boolean;
}

function current(request: HandoffSuggestionRequest): boolean {
  if (useComposerSessionContextStore.getState().handoffSuggestionRequest !== request
    || useProjectStore.getState().currentSessionId !== request.sessionId) return false;
  if (request.approvedPlan) return usePlanReviewStore.getState().bySession[request.sessionId]?.approvedHandoff?.planHash === request.approvedPlan.hash;
  if (!request.sourcePlan) return true;
  return isCurrentPlanReview({ sessionId: request.sessionId, reviewId: request.sourcePlan.reviewId }, 'approve');
}

/** A handoff that executes a reviewed plan says so, and main verifies the claim before accepting the message. */
function executionReference(request: HandoffSuggestionRequest): Pick<HandoffSendPayload, 'planReference'> {
  const plan = request.sourcePlan ?? request.approvedPlan;
  return plan ? { planReference: { intent: 'execute', sessionId: request.sessionId, planId: plan.planId, revision: plan.revision, expectedHash: plan.hash } } : {};
}

export function useQueuedHandoffSuggestion(input: {
  sessionId?: string | null;
  isComposerBusy: boolean;
  setPromptValue: (value: string) => void;
  sendPrompt: (payload: HandoffSendPayload) => Promise<ComposerSendOutcome | undefined>;
  inspectRequest: (sessionId: string, requestId: string) => Promise<ComposerSendOutcome>;
}) {
  const request = useComposerSessionContextStore(state => state.handoffSuggestionRequest);
  const review = usePlanReviewStore(state => request?.sourcePlan ? state.bySession[request.sessionId] : undefined);
  const activeTurn = useComposerSessionContextStore(state => state.activeTurn);
  const isPromptSending = useComposerSessionContextStore(state => state.isPromptSending);
  const [ready, setReady] = useState<Delivery | null>(null);
  const claimed = useRef<Delivery | null>(null);
  const retrying = useRef(false);
  const callbacks = useRef(input);
  callbacks.current = input;
  useEffect(() => {
    if (request?.sourcePlan && !current(request)
      && useComposerSessionContextStore.getState().handoffSuggestionRequest === request) {
      useComposerSessionContextStore.getState().clearHandoffSuggestion();
      setReady(null);
    }
  }, [request, review]);
  useEffect(() => {
    if (!request || request.phase === 'confirming' || request.sessionId !== input.sessionId || !current(request)) { setReady(null); return; }
    let mounted = true;
    const live = () => mounted && current(request);
    void applyDeclaredHandoffOnClient(request.sessionId, request.agentId, request.label, live, request.approvedPlan?.hash ?? request.sourcePlan?.hash).then(result => {
      if (!live()) return;
      if (!result.ok) throw new Error(result.error || 'Agent switch failed.');
      const prompt = result.suggestion?.prompt || request.prompt;
      if (request.send) setReady({ request, payload: { sessionId: request.sessionId, agentId: request.agentId, prompt, ...executionReference(request) } });
      else {
        callbacks.current.setPromptValue(prompt);
        useComposerSessionContextStore.getState().clearHandoffSuggestion();
      }
    }).catch((error: unknown) => {
      if (!live()) return;
      setReady({ request, payload: { sessionId: request.sessionId, agentId: request.agentId, prompt: '' },
        error: error instanceof Error ? error.message : String(error), switchFailed: true });
    });
    return () => { mounted = false; };
  }, [request, input.sessionId]);

  useEffect(() => {
    if (!ready || ready.error || claimed.current === ready || !current(ready.request)) return;
    if (activeTurn || isPromptSending || input.isComposerBusy) return;
    if (!ready.payload.prompt.trim()) return;
    claimed.current = ready;
    void callbacks.current.sendPrompt(ready.payload).then(outcome => {
      if (!current(ready.request)) return;
      if (!outcome) { claimed.current = null; return; }
      if (outcome.status === 'accepted' || outcome.status === 'cancelled') {
        useComposerSessionContextStore.getState().clearHandoffSuggestion(); setReady(null);
      } else setReady({ ...ready, outcome, error: outcome.error || 'HANDOFF_SEND_FAILED' });
    }).catch(() => {
      if (current(ready.request)) setReady({ ...ready,
        outcome: { status: 'unknown', requestId: '' }, error: 'HANDOFF_DELIVERY_UNCONFIRMED' });
    });
  }, [ready, input.sessionId, input.isComposerBusy, activeTurn, isPromptSending]);

  const retry = async () => {
    if (retrying.current || !ready || !current(ready.request)) return;
    retrying.current = true;
    try {
      if (ready.switchFailed) {
        useComposerSessionContextStore.getState().queueHandoffSuggestion({ ...ready.request });
      } else if (ready.outcome?.status === 'unknown') {
        const outcome = await callbacks.current.inspectRequest(ready.payload.sessionId, ready.outcome.requestId);
        if (!current(ready.request)) return;
        if (outcome.status === 'accepted') { useComposerSessionContextStore.getState().clearHandoffSuggestion(); setReady(null); }
        else setReady({ ...ready, outcome, error: outcome.error || 'HANDOFF_DELIVERY_UNCONFIRMED' });
      } else { claimed.current = null; setReady({ ...ready, error: undefined, outcome: undefined }); }
    } finally { retrying.current = false; }
  };
  return { phase: request ? request.phase === 'confirming' ? 'confirming' as const : claimed.current?.request === request ? 'preparing' as const : 'handoff' as const : undefined, error: ready && request === ready.request ? ready.error : undefined,
    checking: ready?.outcome?.status === 'unknown', retry };
}
