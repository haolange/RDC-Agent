import React from 'react';
import { PlanCard } from './PlanCard';
import { usePlanReader } from './PlanReaderHost';
import { planDeliverables } from './planDeliverables';
import type { ConversationWorkTrace } from '@shared/types/conversation';

/** The plan a reply delivers, after its Working: one card per plan, at its latest revision. */
export const PlanDeliverable: React.FC<{ trace: ConversationWorkTrace | null }> = ({ trace }) => {
  const plans = React.useMemo(() => planDeliverables(trace), [trace]);
  const openPlan = usePlanReader();
  return plans.length > 0 ? <>
    {plans.map((plan) => (
      <div key={plan.planId} className="plan-deliverable" data-testid="plan-deliverable">
        <PlanCard plan={plan} onOpen={openPlan} />
      </div>
    ))}
  </> : null;
};
