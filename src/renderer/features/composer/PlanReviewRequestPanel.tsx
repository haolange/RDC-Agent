import React, { useMemo, useState } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { findPendingPlanReview, type PendingPlanReviewRequest } from './planReviewRequestModel';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import './composer-plan-review.css';

export const usePendingPlanReviewRequest = (): PendingPlanReviewRequest | null => {
  const messages = useConversationStore((state) => state.conversationMessages);
  return useMemo(() => findPendingPlanReview(messages), [messages]);
};

export const PlanReviewRequestPanel: React.FC<{
  request: PendingPlanReviewRequest;
}> = ({ request }) => {
  const { t } = useI18n();
  const submit = usePlanReviewSubmit();
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReject = feedback.trim().length > 0;

  const run = async (decision: Parameters<typeof submit>[1]) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await submit(request, decision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-plan-review" data-testid="plan-review-request-panel">
      <h2 className="composer-plan-review__title">{request.planReview.title}</h2>
      {request.planReview.summary.length > 0 ? (
        <ul className="composer-plan-review__summary">
          {request.planReview.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <label className="composer-plan-review__label" htmlFor="plan-review-feedback">
        {t('chat.planReviewFeedbackLabel')}
      </label>
      <textarea
        id="plan-review-feedback"
        className="input composer-plan-review__feedback"
        value={feedback}
        disabled={isSubmitting}
        placeholder={t('chat.planReviewFeedbackPlaceholder')}
        onChange={(event) => setFeedback(event.currentTarget.value)}
      />
      <div className="composer-plan-review__actions">
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting || !canReject}
          onClick={() => void run({ kind: 'reject', feedback: feedback.trim() })}
        >
          {t('chat.planReviewReject')}
        </Button>
        <HandoffActionRow
          options={request.planReview.handoffOptions}
          disabled={isSubmitting}
          onSelect={(handoff) => void run({ kind: 'approve', handoff })}
        />
      </div>
      {error ? <p className="composer-plan-review__error" role="alert">{error}</p> : null}
    </section>
  );
};
