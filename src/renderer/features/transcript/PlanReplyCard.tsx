import React, { useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../i18n';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { FailureAlert } from '../../patterns/FailureAlert';
import { Button } from '../../ui/Button';
import { Chevron } from '../../ui/Chevron';
import { PlainButton } from '../../ui/PlainButton';
import { planPreview } from './planPreview';
import { usePlanPreviewOverflow } from './usePlanPreviewOverflow';
import { PlanDocumentBody, usePlanDocument } from './PlanDocument';
import type { ConversationPlanReview } from '@shared/types/planReview';
import './plan-card.css';

/**
 * The approved plan a reply delivers. Folded, it shows the opening of the plan under a fade; opened, the full verified
 * plan unfolds in the transcript itself, read by scrolling like any reply (Working's plan card opens the reader).
 */
export const PlanReplyCard: React.FC<{ plan: ConversationPlanReview; sessionId: string | null }> = ({
  plan,
  sessionId,
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const preview = planPreview(plan);
  // Measured again whenever the excerpt remounts, after the card folds.
  const { previewRef, overflowing } = usePlanPreviewOverflow(expanded ? '' : preview);
  // The full text is read only once the person opens the card, and again for a new revision.
  const document = usePlanDocument(plan, expanded ? sessionId : null);

  return (
    <section
      className={cn('plan-card', 'plan-reply-card', `is-${plan.status}`, expanded && 'is-expanded')}
      data-plan-id={plan.planId}
      data-testid="plan-reply-card"
      onClick={(event) => {
        // Folded, the whole card opens it; opened, only the header folds it so reading and selecting stay free.
        if (expanded || window.getSelection()?.toString()) return;
        if ((event.target as Element).closest('button, a, input, summary')) return;
        setExpanded(true);
      }}
    >
      <PlainButton
        className="plan-reply-card__toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={`${t('chat.planReplyKind')} · ${plan.title}`}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="plan-card__head">
          <span>{t('chat.planReplyKind')}</span>
          <span className="plan-reply-card__state">
            {t('chat.planReviewStatusApproved')}
            <Chevron open={expanded} size={12} />
          </span>
        </span>
        {/* Opened, the plan's own heading leads; repeating the title above it would say it twice. */}
        {expanded ? null : (
          <span className="plan-card__title" data-tooltip={plan.title}>
            {plan.title}
          </span>
        )}
      </PlainButton>
      <div id={bodyId} className="plan-reply-card__body">
        {expanded ? (
          <>
            {document.error ? <FailureAlert reason={document.error} contextKey="app.error.actionFailed" /> : null}
            <PlanDocumentBody plan={plan} document={document} />
            <Button variant="ghost" size="sm" className="plan-reply-card__fold" onClick={() => setExpanded(false)}>
              {t('chat.planReplyCollapse')}
            </Button>
          </>
        ) : (
          <div ref={previewRef} className={cn('plan-card__preview', overflowing && 'is-overflowing')}>
            <MessageMarkdown content={preview} deferHeavyPlugins interactive={false} />
          </div>
        )}
      </div>
    </section>
  );
};
