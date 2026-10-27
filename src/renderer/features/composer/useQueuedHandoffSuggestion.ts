import { useEffect, useRef, useState } from 'react';
import { isPlanReviewContinuationCurrent } from './planReviewRequestModel';
import { applyDeclaredHandoffOnClient } from './sessionAgentId';
import { useComposerSessionContextStore, type HandoffSuggestionRequest } from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
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
    || useProjectStore.getState().currentSession?.sessionId !== request.sessionId) return false;
  if (!request.sourcePlan) return true;
  const messages = useConversationStore.getState().conversationMessages;
  const plan = messages.flatMap(message => message.workTrace?.blocks.flatMap(block => block.toolCalls
    .filter(call => (call.delegatedRequest?.turnId ?? message.turnId) === request.sourcePlan!.turnId)) ?? [])
    .filter(call => call.planReview).at(-1)?.planReview;
  if (plan?.planId !== request.sourcePlan.planId || plan.revision !== request.sourcePlan.revision
    || plan.hash !== request.sourcePlan.hash) return false;
  return !!plan && isPlanReviewContinuationCurrent(messages, { sessionId: request.sessionId,
    turnId: request.sourcePlan.turnId, toolCallId: request.sourcePlan.toolCallId, planReview: plan });
}

export function useQueuedHandoffSuggestion(input: {
  sessionId?: string | null;
  isComposerBusy: boolean;
  setPromptValue: (value: string) => void;
  sendPrompt: (payload: HandoffSendPayload) => Promise<ComposerSendOutcome | undefined>;
  inspectRequest: (sessionId: string, requestId: string) => Promise<ComposerSendOutcome>;
}) {
  const request = useComposerSessionContextStore(state => state.handoffSuggestionRequest);
  const activeTurn = useComposerSessionContextStore(state => state.activeTurn);
  const isPromptSending = useComposerSessionContextStore(state => state.isPromptSending);
  const [ready, setReady] = useState<Delivery | null>(null);
  const claimed = useRef<Delivery | null>(null);
  const retrying = useRef(false);
  const callbacks = useRef(input);
  callbacks.current = input;
  useEffect(() => {
    if (!request || request.sessionId !== input.sessionId || !current(request)) { setReady(null); return; }
    let mounted = true;
    const live = () => mounted && current(request);
    void applyDeclaredHandoffOnClient(request.sessionId, request.agentId, request.label, live).then(result => {
      if (!live()) return;
      if (!result.ok) throw new Error(result.error || 'Agent switch failed.');
      const prompt = result.suggestion?.prompt || request.prompt;
      if (request.send) setReady({ request, payload: { sessionId: request.sessionId, agentId: request.agentId, prompt } });
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
  return { error: ready && request === ready.request ? ready.error : undefined,
    checking: ready?.outcome?.status === 'unknown', retry };
}
