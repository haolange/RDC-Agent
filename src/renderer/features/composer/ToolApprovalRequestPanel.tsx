import React, { useRef, useState } from 'react';
import type { PendingToolApprovalRequest } from './toolApprovalRequestModel';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useToolApprovalSubmit } from './useToolApprovalSubmit';

export const ToolApprovalRequestPanel: React.FC<{
  request: PendingToolApprovalRequest;
}> = ({ request }) => {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitApproval = useToolApprovalSubmit();
  const submittingRef = useRef(false);

  const submitDecision = async (approved: boolean) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitApproval(request, approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the approval decision.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-tool-approval-panel" data-testid="composer-tool-approval-panel">
      <div className="composer-tool-approval-header">
        <ActiveSignalText active tone="info" className="composer-tool-approval-kicker">{t('composer.toolApprovalKicker')}</ActiveSignalText>
        <p>{request.question}</p>
      </div>
      <div className="composer-tool-approval-meta" aria-label="Approval context">
        <span>{request.toolName}</span>
        <span>{t((
          {
            low: 'composer.toolApprovalRisk.low',
            medium: 'composer.toolApprovalRisk.medium',
            high: 'composer.toolApprovalRisk.high',
          } as const
        )[request.risk])}</span>
        {request.reviewer ? <span>{request.reviewer}</span> : null}
      </div>
      <div className="composer-tool-approval-actions">
        <Button
          variant="secondary"
          className="composer-tool-approval-deny"
          disabled={isSubmitting}
          onClick={() => void submitDecision(false)}
        >
          {t('composer.toolApprovalDeny')}
        </Button>
        <Button
          variant="primary"
          className="composer-tool-approval-approve"
          disabled={isSubmitting}
          onClick={() => void submitDecision(true)}
        >
          {t('composer.toolApprovalApproveOnce')}
        </Button>
      </div>
      {error ? (
        <p className="composer-user-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
