import React, { useRef } from 'react';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { useI18n } from '../../i18n';
import { usePlanReader } from './PlanReaderHost';
import { Button } from '../../ui/Button';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { planPreview } from './planPreview';
import './plan-card.css';

const STATUS_KEY = {
  awaiting: 'chat.planReviewStatusAwaiting',
  approved: 'chat.planReviewStatusApproved',
  rejected: 'chat.planReviewStatusRejected',
  superseded: 'chat.planReviewStatusSuperseded',
} as const;

export const PlanCard: React.FC<{
  plan: ConversationPlanReview;
}> = ({ plan }) => {
  const { t } = useI18n();
  const open = usePlanReader();
  const readButton = useRef<HTMLButtonElement>(null);
  const showPlan = () => { readButton.current?.focus(); open(plan); };

  return (
    <>
      <section
        className={`plan-card is-${plan.status}`}
        data-testid="plan-card"
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
        <h3 className="plan-card__title">{plan.title}</h3>
        <div className="plan-card__preview">
          <MessageMarkdown content={planPreview(plan)} deferHeavyPlugins interactive={false} />
        </div>
        <Button ref={readButton} data-plan-id={plan.planId} variant="ghost" className="plan-card__open" onClick={showPlan}>
          {t('chat.planReviewReadFull')}
        </Button>
      </section>
    </>
  );
};
