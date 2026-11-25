import { useCallback } from 'react';
import { useComposerSessionContextStore } from '../stores/composerSessionContextStore';
import { useProjectStore } from '../stores/projectStore';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';

export function useHandoffSuggestionActions() {
  return useCallback((suggestion: PlanReviewHandoffSuggestion) => {
    const sessionId = useProjectStore.getState().currentSessionId;
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
