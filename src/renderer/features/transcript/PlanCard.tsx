import React, { useRef } from 'react';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { useI18n } from '../../i18n';
import { usePlanReader } from './PlanReaderHost';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { planPreview } from './planPreview';
import { usePlanPreviewOverflow } from './usePlanPreviewOverflow';
import './plan-card.css';

const STATUS_KEY = {
  awaiting: 'chat.planReviewStatusAwaiting',
  approved: 'chat.planReviewStatusApproved',
  rejected: 'chat.planReviewStatusRejected',
  superseded: 'chat.planReviewStatusSuperseded',
  cancelled: 'chat.planReviewStatusCancelled',
} as const;

export const PlanCard: React.FC<{
  plan: ConversationPlanReview;
}> = ({ plan }) => {
  const { t } = useI18n();
  const open = usePlanReader();
  const readButton = useRef<HTMLElement>(null);
  const preview = planPreview(plan);
  const { previewRef, overflowing } = usePlanPreviewOverflow(preview);
  const showPlan = () => { readButton.current?.focus(); open(plan); };

  return (
    <>
      <section
        className={`plan-card is-${plan.status}`}
        ref={readButton}
        role="button"
        tabIndex={0}
        data-plan-id={plan.planId}
        aria-label={`${t('chat.planReviewReadFull')} · ${plan.title}`}
        data-testid="plan-card"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          showPlan();
        }}
        onClick={(event) => {
          if (window.getSelection()?.toString()) return;
          if ((event.target as Element).closest('button, a, input, summary')) return;
          showPlan();
        }}
      >
        <div className="plan-card__head">
          <span>{t('chat.planReviewCardKind')}</span>
          <span>{t(STATUS_KEY[plan.status])}</span>
        </div>
        <h3 className="plan-card__title" title={plan.title}>{plan.title}</h3>
        <div ref={previewRef} className={`plan-card__preview${overflowing ? ' is-overflowing' : ''}`}>
          <MessageMarkdown content={preview} deferHeavyPlugins interactive={false} />
        </div>
      </section>
    </>
  );
};
