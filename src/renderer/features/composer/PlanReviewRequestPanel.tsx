import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { Textarea } from '../../ui/Textarea';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { InlineError } from '../../ui/InlineError';
import { HandoffActionRow } from '../../patterns/HandoffActionRow/HandoffActionRow';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { cancelPlanReview } from '../../services/planReviewService';
import { useElectronApi } from '../../hooks/useElectronApi';
import { errorDetail } from '../../lib/errorDetail';
import { ComposerModelEffortControl, type ComposerModelSaveState } from './ComposerModelEffortControl';
import { capabilityStatusPresentation } from './capabilityPresentation';
import { useComposerTurnControls } from './ComposerTurnControlsContext';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import { type PendingPlanReviewRequest } from './planReviewRequestModel';
import type { SessionRecord } from '@shared/types/session';
import type { HandoffSendPayload } from './composerHandoffSend';
import './composer-plan-review.css';

export const PlanReviewRequestPanel: React.FC<{
  request: PendingPlanReviewRequest;
  agentId: string;
  currentSession: SessionRecord | null;
  onReplan?: (payload: HandoffSendPayload) => Promise<unknown>;
}> = ({ request, agentId, currentSession, onReplan }) => {
  const { t } = useI18n();
  const api = useElectronApi();
  const submit = usePlanReviewSubmit(onReplan);
  const transition = useComposerSessionContextStore(state => {
    const queued = state.handoffSuggestionRequest;
    return queued?.sessionId === request.sessionId && queued.sourcePlan?.reviewId === request.reviewId && queued.sourcePlan.turnId === request.turnId
      && queued.sourcePlan.toolCallId === request.toolCallId && queued.sourcePlan.planId === request.planReview.planId
      && queued.sourcePlan.revision === request.planReview.revision && queued.sourcePlan.hash === request.planReview.hash ? queued : null;
  });
  const { capabilityState, retryCapability } = useComposerTurnControls();
  const modelAvailable = capabilityState.status === 'ready' || capabilityState.status === 'refreshing';
  const modelStatus = capabilityStatusPresentation(capabilityState);
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
    if (submitting.current || transition || modelSave.saving || (decision.kind === 'approve' && (modelSave.error || !modelAvailable)) || (decision.kind === 'reject' && !decision.feedback.trim())) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await submit(request, decision);
    } catch (reason) {
      if (mounted.current) setError(errorDetail(reason));
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  const stop = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await cancelPlanReview(api, { sessionId: request.sessionId, reviewId: request.reviewId });
    } catch (reason) {
      if (mounted.current) setError(errorDetail(reason));
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-plan-review" data-testid="plan-review-request-panel" aria-busy={isSubmitting || !!transition}>
      <div className="composer-plan-review__header">
        <h2 className="composer-plan-review__title">{t('chat.planReviewImplement')}</h2>
        <IconButton className="composer-plan-review__stop" size="sm" label={t('chat.planReviewStop')}
          data-tooltip={t('chat.planReviewStop')} disabled={isSubmitting} onClick={() => void stop()}>
          <Icon name="stop" size={16} />
        </IconButton>
      </div>
      <div className="composer-plan-review__body">
      <HandoffActionRow
        presentation="decisions"
        options={request.planReview.handoffOptions}
        disabled={isSubmitting || !!transition || modelSave.saving || !!modelSave.error || !modelAvailable}
        onSelect={({ agent, label }) => void run({ kind: 'approve', handoff: { agent, label } })}
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
      {modelSave.error ? <InlineError detail={modelSave.error} onRetry={modelSave.retry ?? undefined} retryLabel={t('composer.model.retrySave')}>{t('app.error.saveFailed')}</InlineError> : null}
      <span className="composer-transition-announcement" role="status">
        {isSubmitting || transition ? t(transition?.phase === 'handoff' ? 'composer.handoff.switching' : 'composer.handoff.confirming') : ''}
      </span>
      {error ? <InlineError detail={error}>{t('app.error.actionFailed')}</InlineError> : null}
      {modelStatus.labelKey && (capabilityState.status === 'error' || capabilityState.status === 'unavailable') ? (
        <InlineError detail={capabilityState.message} onRetry={retryCapability} retryLabel={t('composer.effort.capabilityRetry')}>
          {t(modelStatus.labelKey)}
        </InlineError>
      ) : modelStatus.labelKey ? <p className="composer-transition-status" role="status">{t(modelStatus.labelKey)}</p> : null}
      </div>
      <div className="composer-plan-review__footer">
        <ComposerModelEffortControl agentId={agentId} currentSession={currentSession}
          disabled={isSubmitting || !!transition} onSaveStateChange={setModelSave} />
      </div>
    </section>
  );
};
