import React from 'react';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { useHandoffSuggestionActions } from '../../hooks/useHandoffSuggestionActions';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useI18n } from '../../i18n';

export const HandoffSuggestionRow: React.FC<{
  suggestions: PlanReviewHandoffSuggestion[];
}> = ({ suggestions }) => {
  const { t } = useI18n();
  const onSelect = useHandoffSuggestionActions();
  const disabled = useComposerSessionContextStore(state => !!state.activeTurn || state.isPromptSending || !!state.handoffSuggestionRequest);
  if (suggestions.length === 0) return null;
  return (
    <div className="handoff-suggestion-row" data-testid="handoff-suggestion-row">
      <p className="handoff-suggestion-row__label">{t('chat.handoffSuggestionTitle')}</p>
      <HandoffActionRow
        disabled={disabled}
        options={suggestions.map((suggestion) => ({ label: suggestion.label, agent: suggestion.agent }))}
        onSelect={(option) => {
          const match = suggestions.find((suggestion) => suggestion.agent === option.agent && suggestion.label === option.label);
          if (match) onSelect(match);
        }}
      />
    </div>
  );
};
