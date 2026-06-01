import React, { useState } from 'react';
import type { AskUserPrompt, AskUserQuestion } from '@shared/types/workflow';
import { hasAnswer } from './planHelpers';

export interface AskUserQuestionCardProps {
  prompt: AskUserPrompt;
  answers: Record<string, { selectedOptionId?: string; freeformText?: string }>;
  busy: boolean;
  onAnswerChange: (
    questionId: string,
    patch: { selectedOptionId?: string; freeformText?: string },
  ) => void;
  onSubmit: () => void;
}

export const AskUserQuestionCard: React.FC<AskUserQuestionCardProps> = ({
  prompt,
  answers,
  busy,
  onAnswerChange,
  onSubmit,
}) => {
  const [questionIndex, setQuestionIndex] = useState(0);
  const canSubmit = prompt.questions.length > 0
    && prompt.questions.every((question) => hasAnswer(answers[question.id]));
  const activeQuestionIndex = Math.min(questionIndex, Math.max(prompt.questions.length - 1, 0));
  const activeQuestion = prompt.questions[activeQuestionIndex];
  const hasPrevious = activeQuestionIndex > 0;
  const hasNext = activeQuestionIndex < prompt.questions.length - 1;

  const renderQuestion = (question: AskUserQuestion, questionIndex: number) => (
    <div key={question.id} className="ask-question" data-testid={`plan-question-${question.id}`}>
      <div className="ask-question-prompt">
        <span className="ask-question-number">{questionIndex + 1}</span>
        <span>{question.prompt}</span>
      </div>
      <div className="ask-question-options">
        {question.options.map((option, optionIndex) => {
          const selected = answers[question.id]?.selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`ask-option ${selected ? 'selected' : ''} ${question.recommendedOptionId === option.id ? 'recommended' : ''}`}
              data-testid={`plan-option-${question.id}-${option.id}`}
              onClick={() => onAnswerChange(question.id, { selectedOptionId: option.id })}
            >
              <span className="ask-option-index">{optionIndex + 1}</span>
              <span className="ask-option-copy">
                <span className="ask-option-label">{option.label}</span>
                <span className="ask-option-description">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <label className="ask-freeform-row">
        <span className="ask-option-index">{question.options.length + 1}</span>
        <input
          className="ask-freeform-input"
          placeholder={question.freeformPlaceholder || 'Enter custom answer'}
          value={answers[question.id]?.freeformText || ''}
          onChange={(event) => onAnswerChange(question.id, { freeformText: event.target.value })}
        />
      </label>
    </div>
  );

  return (
    <section className="ask-user-question-card" data-testid="ask-user-question-card">
      <header className="ask-user-question-header">
        <div>
          <h2>{prompt.title}</h2>
          {prompt.summary ? <p>{prompt.summary}</p> : null}
        </div>
        <span className="ask-user-question-count">
          {Math.min(activeQuestionIndex + 1, Math.max(prompt.questions.length, 1))}/{Math.max(prompt.questions.length, 1)}
        </span>
      </header>

      <div className="ask-user-question-body" data-testid="plan-questions">
        {activeQuestion ? renderQuestion(activeQuestion, activeQuestionIndex) : null}
      </div>

      <div className="ask-user-question-footer">
        <div className="ask-user-question-pager">
          <button
            type="button"
            className="ask-question-nav-button"
            aria-label="上一题"
            onClick={() => setQuestionIndex((current) => Math.max(current - 1, 0))}
            disabled={!hasPrevious || busy}
          >
            ‹
          </button>
          <button
            type="button"
            className="ask-question-nav-button"
            aria-label="下一题"
            onClick={() => setQuestionIndex((current) => Math.min(current + 1, prompt.questions.length - 1))}
            disabled={!hasNext || busy}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          className="plan-action-button primary"
          data-testid="plan-submit-answers-button"
          onClick={onSubmit}
          disabled={!canSubmit || busy}
        >
          {busy ? '提交中...' : '提交回答'}
        </button>
      </div>
    </section>
  );
};
