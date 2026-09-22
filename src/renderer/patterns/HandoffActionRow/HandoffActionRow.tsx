import React from 'react';
import type { PlanReviewHandoffOption } from '@shared/types/planReview';
import { Button } from '../../ui/Button';
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
}) => (
  <div className={`handoff-action-row is-${presentation}`} data-testid={testId} role="group">
    {options.map((option, index) => (
      <Button
        key={`${option.agent}:${option.label}`}
        type="button"
        variant={presentation === 'decisions' ? 'secondary' : 'primary'}
        className="handoff-action-row__button"
        disabled={disabled}
        onClick={() => onSelect(option)}
      >
        {presentation === 'decisions' ? <span className="handoff-action-row__number" aria-hidden="true">{index + 1}</span> : null}
        <span className="handoff-action-row__label">{option.label}</span>
        {presentation === 'decisions' ? <span className="handoff-action-row__arrow" aria-hidden="true">→</span> : null}
      </Button>
    ))}
  </div>
);
