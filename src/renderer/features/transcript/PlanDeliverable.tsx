import React from 'react';
import { useI18n } from '../../i18n';
import { findPlanLocation, requestPlanLocation } from '../../lib/transcriptPlanLocation';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { selectOrderedConversationMessages, useConversationStore } from '../../stores/conversationStore';
import { Icon } from '../../ui/Icon';
import { PlanCard } from './PlanCard';
import { usePlanReader } from './PlanReaderHost';
import { planDeliverables } from './planDeliverables';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';

const PlanHandoffLink: React.FC<{ plan: ConversationPlanReview }> = ({ plan }) => {
  const { t } = useI18n();
  const agentId = plan.decision?.kind === 'approve' ? plan.decision.handoff.agent : undefined;
  const agentName = useAppSettingsStore((state) => state.settings.agents.definitions.find((agent) => agent.id === agentId)?.name) ?? agentId;
  const sent = useConversationStore((state) =>
    findPlanLocation(selectOrderedConversationMessages(state), { target: 'reference', plan }) >= 0);
  if (!agentName) return null;
  return sent ? (
    <button type="button" className="plan-deliverable__handoff" onClick={() => requestPlanLocation({ target: 'reference', plan })}>
      <span>{t('chat.planDeliverable.handedTo', { agent: agentName })}</span>
      <Icon name="arrow-down" size={14} />
    </button>
  ) : <p className="plan-deliverable__handoff is-pending">{t('chat.planDeliverable.approvedFor', { agent: agentName })}</p>;
};

const PlanDeliverableCards: React.FC<{ plans: ConversationPlanReview[] }> = ({ plans }) => {
  const openPlan = usePlanReader();
  return <>
    {plans.map((plan) => (
      <div key={plan.planId} className={`plan-deliverable is-${plan.status}`} data-testid="plan-deliverable"
        data-plan-target="plan" data-plan-key={`${plan.planId}:${plan.revision}`} tabIndex={-1}>
        <PlanCard plan={plan} onOpen={openPlan} />
        {plan.status === 'approved' ? <PlanHandoffLink plan={plan} /> : null}
      </div>
    ))}
  </>;
};

/** The plan a reply delivers, after its Working: one card per plan, at its latest revision. */
export const PlanDeliverable: React.FC<{ trace: ConversationWorkTrace | null }> = ({ trace }) => {
  const plans = React.useMemo(() => planDeliverables(trace), [trace]);
  return plans.length > 0 ? <PlanDeliverableCards plans={plans} /> : null;
};
