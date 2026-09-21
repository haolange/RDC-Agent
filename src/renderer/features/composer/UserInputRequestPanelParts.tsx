import type { FC, RefObject } from 'react';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import { CheckIcon } from './userInputRequestIcons';
import { Textarea } from '../../ui/Textarea';

export const UserInputOptionList: FC<{
  question: ConversationAskUserQuestion;
  selectedOptionId?: string;
  isSubmitting: boolean;
  onSelect: (optionId: string) => void;
}> = ({ question, selectedOptionId, isSubmitting, onSelect }) => (
  <div className="composer-user-input-options" role="radiogroup" aria-label="Answer choices">
    {question.options.map((option, index) => {
      const isSelected = selectedOptionId === option.optionId;
      return (
        <button
          key={option.optionId}
          type="button"
          role="radio"
          aria-checked={isSelected}
          className={`composer-user-input-option${isSelected ? ' is-selected' : ''}`}
          disabled={isSubmitting}
          onClick={() => onSelect(option.optionId)}
        >
          <span className="composer-user-input-option-index" aria-hidden="true">
            {index + 1}
          </span>
          <span className="composer-user-input-option-copy">
            <span className="composer-user-input-option-label">{option.label}</span>
            {option.description ? (
              <span className="composer-user-input-option-description">
                <span className="composer-user-input-option-description-text">{option.description}</span>
                <span className="composer-user-input-option-tooltip" role="tooltip">
                  {option.description}
                </span>
              </span>
            ) : null}
          </span>
          {isSelected ? (
            <span className="composer-user-input-option-check" aria-hidden="true">
              <CheckIcon />
            </span>
          ) : null}
        </button>
      );
    })}
  </div>
);

export const UserInputCustomAnswer: FC<{
  question: ConversationAskUserQuestion;
  selectedOptionId?: string;
  customAnswer: string;
  isSubmitting: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onChange: (answer: string) => void;
}> = ({ question, selectedOptionId, customAnswer, isSubmitting, textareaRef, onChange }) => (
  <div className={`composer-user-input-custom${!selectedOptionId && customAnswer.trim() ? ' is-selected' : ''}`}>
    {question.options.length > 0 ? (
      <button
        type="button"
        className="composer-user-input-custom-select"
        disabled={isSubmitting}
        onClick={() => {
          onChange(customAnswer);
          textareaRef.current?.focus();
        }}
      >
        <span className="composer-user-input-option-index" aria-hidden="true">
          {question.options.length + 1}
        </span>
        <span className="composer-user-input-custom-label">Enter custom answer</span>
        {!selectedOptionId && customAnswer.trim() ? (
          <span className="composer-user-input-option-check" aria-hidden="true">
            <CheckIcon />
          </span>
        ) : null}
      </button>
    ) : null}
    <Textarea
      ref={textareaRef}
      className="composer-user-input-custom-field"
      value={customAnswer}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => {
        if (selectedOptionId) {
          onChange('');
        }
      }}
      placeholder="Type your answer..."
      disabled={isSubmitting}
      aria-label="Custom answer"
    />
  </div>
);
