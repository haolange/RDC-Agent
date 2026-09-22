import React, { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Textarea';
import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { type PendingPlanReviewRequest } from './planReviewRequestModel';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import './composer-plan-review.css';

export const PlanReviewRequestPanel: React.FC<{
  request: PendingPlanReviewRequest;
}> = ({ request }) => {
  const { t } = useI18n();
  const submit = usePlanReviewSubmit();
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const feedbackId = useId();
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (editing) feedbackRef.current?.focus(); }, [editing]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReject = feedback.trim().length > 0;

  const run = async (decision: Parameters<typeof submit>[1]) => {
    if (submitting.current || (decision.kind === 'reject' && !decision.feedback.trim())) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await submit(request, decision);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-plan-review" data-testid="plan-review-request-panel" aria-busy={isSubmitting}>
      <h2 className="composer-plan-review__title">{t('chat.planReviewImplement')}</h2>
      <HandoffActionRow
        presentation="decisions"
        options={request.planReview.handoffOptions}
        disabled={isSubmitting}
        onSelect={(handoff) => void run({ kind: 'approve', handoff })}
      />
      <Button variant="ghost" className="composer-plan-review__edit" disabled={isSubmitting}
        aria-expanded={editing} aria-controls={feedbackId} onClick={() => setEditing(!editing)}>
        {t('chat.planReviewFeedbackLabel')}
      </Button>
      {editing ? <div id={feedbackId} className="composer-plan-review__revision">
        <Textarea
          ref={feedbackRef}
          aria-label={t('chat.planReviewFeedbackLabel')}
          className="composer-plan-review__feedback"
          value={feedback}
          minRows={2} maxRows={5}
          disabled={isSubmitting}
          placeholder={t('chat.planReviewFeedbackPlaceholder')}
          onChange={(event) => setFeedback(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting || !canReject}
          onClick={() => void run({ kind: 'reject', feedback: feedback.trim() })}
        >
          {t('chat.planReviewReject')}
        </Button>
      </div> : null}
      {error ? <p className="composer-plan-review__error" role="alert">{error}</p> : null}
    </section>
  );
};
