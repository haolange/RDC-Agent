import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import { Textarea } from '../../ui/Textarea';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { type PendingPlanReviewRequest } from './planReviewRequestModel';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import { usePlanReviewModelAvailability } from './usePlanReviewModelAvailability';
import { ComposerModelEffortControl, type ComposerModelSaveState } from './ComposerModelEffortControl';
import './composer-plan-review.css';

export const PlanReviewRequestPanel: React.FC<{
  request: PendingPlanReviewRequest;
  agentId: string;
  currentSession: SessionRecord | null;
  onStop?: () => Promise<void>;
}> = ({ request, agentId, currentSession, onStop }) => {
  const { t } = useI18n();
  const submit = usePlanReviewSubmit();
  const transition = useComposerSessionContextStore(state => {
    const queued = state.handoffSuggestionRequest;
    return queued?.sessionId === request.sessionId && queued.sourcePlan?.turnId === request.turnId
      && queued.sourcePlan.toolCallId === request.toolCallId && queued.sourcePlan.planId === request.planReview.planId
      && queued.sourcePlan.revision === request.planReview.revision && queued.sourcePlan.hash === request.planReview.hash ? queued : null;
  });
  const modelAvailable = usePlanReviewModelAvailability(currentSession?.modelOverride);
  const [feedback, setFeedback] = useState('');
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const field = feedbackRef.current;
    if (!field) return;
    const measure = () => setMultiline(field.clientHeight > Number.parseFloat(getComputedStyle(field).lineHeight) * 1.5);
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    measure();
    return () => observer.disconnect();
  }, []);
  const [modelSave, setModelSave] = useState<ComposerModelSaveState>({ saving: false });
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReject = feedback.trim().length > 0;

  const run = async (decision: Parameters<typeof submit>[1]) => {
    if (submitting.current || transition || modelSave.saving || (decision.kind === 'approve' && (modelSave.error || !modelAvailable(decision.handoff.agent))) || (decision.kind === 'reject' && !decision.feedback.trim())) return;
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

  const stop = async () => {
    if (!onStop || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onStop();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-plan-review" data-testid="plan-review-request-panel" aria-busy={isSubmitting}>
      <div className="composer-plan-review__header">
        <h2 className="composer-plan-review__title">{t('chat.planReviewImplement')}</h2>
        {onStop ? <IconButton className="composer-plan-review__stop" size="sm" label={t('chat.planReviewStop')}
          title={t('chat.planReviewStop')} disabled={isSubmitting} onClick={() => void stop()}>
          <Icon name="stop" size={16} />
        </IconButton> : null}
      </div>
      <div className="composer-plan-review__body">
      <HandoffActionRow
        presentation="decisions"
        options={request.planReview.handoffOptions}
        disabled={isSubmitting || !!transition || modelSave.saving || !!modelSave.error}
        isOptionDisabled={(option) => !modelAvailable(option.agent)}
        onSelect={(handoff) => void run({ kind: 'approve', handoff })}
      />
      <div className={`composer-plan-review__revision${multiline ? ' is-multiline' : ''}`}>
        <Icon name="edit" size={16} />
        <Textarea
          ref={feedbackRef}
          aria-label={t('chat.planReviewFeedbackLabel')}
          className="composer-plan-review__feedback"
          chrome="plain"
          value={feedback}
          minRows={1} maxRows={5}
          disabled={isSubmitting || !!transition || modelSave.saving}
          placeholder={t('chat.planReviewFeedbackPlaceholder')}
          onChange={(event) => setFeedback(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            if (canReject) void run({ kind: 'reject', feedback: feedback.trim() });
          }}
        />
        <IconButton
          type="button"
          size="sm"
          label={t('chat.planReviewReject')}
          disabled={isSubmitting || !!transition || modelSave.saving || !canReject}
          onClick={() => void run({ kind: 'reject', feedback: feedback.trim() })}
        >
          <Icon name="arrow-up" size={16} />
        </IconButton>
      </div>
      {modelSave.error ? <p className="composer-plan-review__error" role="alert">{modelSave.error}{modelSave.retry ? <Button variant="ghost" size="sm" onClick={modelSave.retry}>{t('composer.model.retrySave')}</Button> : null}</p> : null}
      {isSubmitting || transition ? <p className="composer-transition-status" role="status">{t(transition?.phase === 'handoff' ? 'composer.handoff.switching' : 'composer.handoff.confirming')}</p> : null}
      {error ? <p className="composer-plan-review__error" role="alert">{error}</p> : null}
      {request.planReview.handoffOptions.every((option) => !modelAvailable(option.agent)) ? <p className="composer-plan-review__error" role="status">{t('composer.model.unavailable')}</p> : null}
      </div>
      <div className="composer-plan-review__footer">
        <ComposerModelEffortControl agentId={agentId} currentSession={currentSession}
          disabled={isSubmitting || !!transition} showAgentDefault onSaveStateChange={setModelSave} />
      </div>
    </section>
  );
};
