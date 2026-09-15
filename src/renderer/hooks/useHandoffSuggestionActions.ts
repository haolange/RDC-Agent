import { useCallback } from 'react';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import { useComposerSessionContextStore } from '../stores/composerSessionContextStore';
import { useProjectStore } from '../stores/projectStore';

export function useHandoffSuggestionActions() {
  return useCallback((suggestion: PlanReviewHandoffSuggestion) => {
    const sessionId = useProjectStore.getState().currentSession?.sessionId;
    if (!sessionId) return;
    useComposerSessionContextStore.getState().queueHandoffSuggestion({
      sessionId,
      agentId: suggestion.agent,
      label: suggestion.label,
      prompt: suggestion.prompt,
      send: suggestion.send,
    });
  }, []);
}
