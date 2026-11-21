import React from 'react';
import { useI18n } from '../../i18n';
import { requestPlanLocation } from '../../lib/transcriptPlanLocation';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { Details } from '../../ui/Details';
import { Icon } from '../../ui/Icon';
import type { ConversationPlanReference } from '@shared/types/planReview';
import './plan-reference-card.css';

/**
 * A user message that executes or revises a reviewed plan, shown as what it does instead of the raw handoff
 * prompt: the plan, its revision and the Agent it goes to. The plan title jumps to that plan's card; the
 * prompt stays one disclosure away.
 */
export const PlanReferenceCard: React.FC<{ reference: ConversationPlanReference; prompt: string }> = ({ reference, prompt }) => {
  const { t } = useI18n();
  const agentName = useAppSettingsStore((state) => state.settings.agents.definitions.find((agent) => agent.id === reference.agentId)?.name)
    ?? reference.agentId;
  const showPlan = () => requestPlanLocation({ target: 'plan', plan: reference });
  return (
    <div className={`plan-reference-card is-${reference.intent}`} data-testid="plan-reference-card"
      data-plan-target="reference" data-plan-key={`${reference.planId}:${reference.revision}`} tabIndex={-1}>
      <div className="plan-reference-card__kind">
        <Icon name={reference.intent === 'execute' ? 'play' : 'edit'} size={14} />
        <span>{t(reference.intent === 'execute' ? 'chat.planReference.execute' : 'chat.planReference.revise')}</span>
      </div>
      <button type="button" className="plan-reference-card__title" onClick={showPlan} data-tooltip={t('chat.planReference.show')}>
        {reference.title}
      </button>
      <div className="plan-reference-card__meta">
        <span>{t('chat.planReference.revision', { revision: reference.revision })}</span>
        <span aria-hidden="true">·</span>
        <span>{t('chat.planReference.target', { agent: agentName })}</span>
      </div>
      {prompt.trim() ? (
        <Details className="plan-reference-card__prompt" summary={t('chat.planReference.prompt')}>
          <MessageMarkdown content={prompt} />
        </Details>
      ) : null}
    </div>
  );
};
