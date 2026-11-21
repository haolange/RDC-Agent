import React, { useRef, useState } from 'react';
import { formatToolApprovalReason } from '../../lib/toolApprovalText';
import { toolCategoryLabel } from '../../lib/toolCategoryLabel';
import { errorDetail } from '../../lib/errorDetail';
import { InlineError } from '../../ui/InlineError';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useToolApprovalSubmit } from './useToolApprovalSubmit';
import type { PendingToolApprovalRequest } from './toolApprovalRequestModel';

export const ToolApprovalRequestPanel: React.FC<{
  request: PendingToolApprovalRequest;
}> = ({ request }) => {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The submission failure's technical reason, kept for the diagnostics disclosure; '' when it carried none.
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
      setError(errorDetail(err));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-tool-approval-panel" data-testid="composer-tool-approval-panel">
      <div className="composer-tool-approval-header">
        <ActiveSignalText active tone="info" className="composer-tool-approval-kicker">{t('composer.toolApprovalKicker')}</ActiveSignalText>
        <p>{formatToolApprovalReason(request.question, t) || t('chat.approvalRequiredMessage')}</p>
      </div>
      <div className="composer-tool-approval-meta" aria-label={t('composer.toolApprovalContext')}>
        <span>{toolCategoryLabel(request.toolName, t)}</span>
        <span className={`composer-tool-approval-risk is-${request.risk}`}>{t(`composer.toolApprovalRisk.${request.risk}`)}</span>
        {request.reviewer ? <span>{t(request.reviewer === 'user' ? 'chat.workProcessManualReviewMeta' : 'chat.workProcessAutoReviewMeta')}</span> : null}
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
      {error !== null ? <InlineError detail={error || undefined}>{t('composer.toolApprovalSubmitFailed')}</InlineError> : null}
    </section>
  );
};
