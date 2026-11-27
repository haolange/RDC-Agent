import React from 'react';
import { useI18n } from '../../i18n';
import { SectionHeader } from '../../ui/SectionHeader';
import { planAuthorizationText } from './planAuthorizationText';
import type { PlanAuthorization } from '@shared/types/planInvestigation';
import './PlanAuthorizationList.css';

/** The interventions approving a plan authorizes: what the user agrees auto-review may admit without asking again. */
export const PlanAuthorizationList: React.FC<{ authorizations: readonly PlanAuthorization[] }> = ({
  authorizations,
}) => {
  const { t } = useI18n();
  if (!authorizations.length) return null;
  return (
    <section className="plan-authorizations" data-testid="plan-authorizations">
      <SectionHeader title={t('chat.planAuthorizationsTitle')} description={t('chat.planAuthorizationsHint')} />
      <ul className="plan-authorizations__list">
        {authorizations.map((item) => {
          const text = planAuthorizationText(item, t);
          return (
            <li key={JSON.stringify([item.operation, item.target])} className="plan-authorizations__item">
              <span className="plan-authorizations__item-title">{text.title}</span>
              <span className="plan-authorizations__item-detail">{text.detail}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
