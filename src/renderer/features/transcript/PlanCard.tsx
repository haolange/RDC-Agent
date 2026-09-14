import React, { useState, useCallback } from 'react';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { useI18n } from '../../i18n';
import { PlanReviewPanel } from './PlanReviewPanel';
import { Button } from '../../ui/Button';
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
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <section
        className={`plan-card is-${plan.status}`}
        data-testid="plan-card"
      >
        <div className="plan-card__head">
          <span>{t('chat.planReviewCardKind')}</span>
          <span>{t(STATUS_KEY[plan.status])}</span>
        </div>
        <h3 className="plan-card__title"><Button variant="ghost" className="plan-card__open" onClick={() => setOpen(true)}>{plan.title}</Button></h3>
        {plan.summary.length > 0 ? (
          <ul className="plan-card__summary">
            {plan.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="plan-card__sections">
          {plan.sections.slice(0, 3).map((section) => (
            <details key={section.heading || section.body.slice(0, 24)} className="plan-card__section">
              <summary className="plan-card__section-title">{section.heading || t('chat.planReviewUntitledSection')}</summary>
              <p className="plan-card__section-body">{section.body}</p>
            </details>
          ))}
        </div>
        <div className="plan-card__foot">
          <span>v{plan.revision}</span>
          <span>{plan.uri}</span>
        </div>
        <span className="plan-card__fade" aria-hidden="true" />
      </section>
      {open ? <PlanReviewPanel plan={plan} onClose={close} /> : null}
    </>
  );
};
