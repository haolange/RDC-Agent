import React from 'react';
import type { PlanReviewHandoffOption } from '@shared/types/planReview';
import { Button } from '../../ui/Button';
import { resolveHandoffLabel } from '@shared/utils/handoffLabels';
import { useI18n } from '../../i18n';
import './HandoffActionRow.css';

export interface HandoffActionRowProps {
  options: PlanReviewHandoffOption[];
  onSelect: (option: PlanReviewHandoffOption) => void;
  disabled?: boolean;
  testId?: string;
  presentation?: 'buttons' | 'decisions';
}

export const HandoffActionRow: React.FC<HandoffActionRowProps> = ({
  options,
  onSelect,
  disabled = false,
  testId = 'handoff-action-row',
  presentation = 'buttons',
}) => {
  const { language } = useI18n();
  return (
    <div className={`handoff-action-row is-${presentation}`} data-testid={testId} role="group">
      {options.map((option) => (
        <Button
          key={`${option.agent}:${option.label}`}
          type="button"
          variant={presentation === 'decisions' ? 'secondary' : 'primary'}
          className="handoff-action-row__button"
          disabled={disabled}
          onClick={() => onSelect(option)}
        >
          <span className="handoff-action-row__label">{resolveHandoffLabel(option, language)}</span>
        </Button>
      ))}
    </div>
  );
};
