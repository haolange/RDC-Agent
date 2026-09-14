import React from 'react';
import type { PlanReviewHandoffOption } from '@shared/types/planReview';
import { Button } from '../../ui/Button';
import './HandoffActionRow.css';

export interface HandoffActionRowProps {
  options: PlanReviewHandoffOption[];
  onSelect: (option: PlanReviewHandoffOption) => void;
  disabled?: boolean;
  testId?: string;
}

export const HandoffActionRow: React.FC<HandoffActionRowProps> = ({
  options,
  onSelect,
  disabled = false,
  testId = 'handoff-action-row',
}) => (
  <div className="handoff-action-row" data-testid={testId} role="group">
    {options.map((option) => (
      <Button
        key={`${option.agent}:${option.label}`}
        type="button"
        variant="primary"
        className="handoff-action-row__button"
        disabled={disabled}
        onClick={() => onSelect(option)}
      >
        {option.label}
      </Button>
    ))}
  </div>
);
