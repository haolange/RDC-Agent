import { useEffect, useRef, useState } from 'react';
import { persistSessionAgentId } from './sessionAgentId';
import { useComposerSessionContextStore, type HandoffSuggestionRequest } from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';

export function useQueuedHandoffSuggestion(input: {
  sessionId?: string | null;
  promptValue: string;
  setPromptValue: (value: string) => void;
  sendPrompt: () => Promise<void> | void;
  showNotice: (message: string) => void;
}): void {
  const request = useComposerSessionContextStore(state => state.handoffSuggestionRequest);
  const [ready, setReady] = useState<HandoffSuggestionRequest | null>(null);
  const callbacks = useRef(input);
  callbacks.current = input;
  useEffect(() => {
    if (!request || request.sessionId !== input.sessionId) return;
    let mounted = true;
    const current = () => mounted
      && useComposerSessionContextStore.getState().handoffSuggestionRequest === request
      && useProjectStore.getState().currentSession?.sessionId === request.sessionId;
    void persistSessionAgentId(request.sessionId, request.agentId).then(result => {
      if (!current()) return;
      if (!result.ok) throw new Error(result.error || 'Agent switch failed.');
      callbacks.current.setPromptValue(request.prompt);
      if (request.send) setReady(request);
      else useComposerSessionContextStore.getState().clearHandoffSuggestion();
    }).catch((error: unknown) => {
      if (!current()) return;
      callbacks.current.showNotice(error instanceof Error ? error.message : String(error));
      useComposerSessionContextStore.getState().clearHandoffSuggestion();
    });
    return () => { mounted = false; };
  }, [request, input.sessionId]);

  useEffect(() => {
    if (!ready) return;
    const store = useComposerSessionContextStore.getState();
    if (store.handoffSuggestionRequest !== ready || ready.sessionId !== input.sessionId) { setReady(null); return; }
    if (input.promptValue !== ready.prompt) return;
    setReady(null);
    store.clearHandoffSuggestion();
    if (store.activeTurn || store.isPromptSending || !ready.prompt.trim()) return;
    void Promise.resolve(callbacks.current.sendPrompt()).catch((error: unknown) => {
      if (useProjectStore.getState().currentSession?.sessionId === ready.sessionId) {
        callbacks.current.showNotice(error instanceof Error ? error.message : String(error));
      }
    });
  }, [ready, input.promptValue, input.sessionId]);
}
