import React, { useRef } from 'react';
import { useI18n } from '../../i18n';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { ProximityGlow } from '../../ui/ProximityHost';
import { planPreview } from './planPreview';
import { usePlanPreviewOverflow } from './usePlanPreviewOverflow';
import type { ConversationPlanReview } from '@shared/types/planReview';
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
  onOpen: (plan: ConversationPlanReview) => void;
}> = ({ plan, onOpen }) => {
  const { t } = useI18n();
  const readButton = useRef<HTMLElement>(null);
  const preview = planPreview(plan);
  const { previewRef, overflowing } = usePlanPreviewOverflow(preview);
  const showPlan = () => { readButton.current?.focus(); onOpen(plan); };

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
        data-proximity
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
        <ProximityGlow />
        <div className="plan-card__head">
          <span className="plan-card__kind">
            {t('chat.planReviewCardKind')}
            {plan.revision > 1 ? <span className="plan-card__revision">{t('chat.planReviewRevision', { revision: plan.revision })}</span> : null}
          </span>
          <span className={`plan-card__status is-${plan.status}`}>{t(STATUS_KEY[plan.status])}</span>
        </div>
        <h3 className="plan-card__title" data-tooltip={plan.title} data-work-node-prose>{plan.title}</h3>
        <div ref={previewRef} className={`plan-card__preview${overflowing ? ' is-overflowing' : ''}`}>
          <MessageMarkdown content={preview} deferHeavyPlugins interactive={false} />
        </div>
      </section>
    </>
  );
};
