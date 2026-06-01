import React from 'react';
import type { AgentNode } from '@shared/types/agentTimeline';
import { PlanApprovalCard } from '../features/debugger/PlanIntakePanel';

export const PlanCard: React.FC<{ node: AgentNode }> = ({ node }) => (
  <div className="amt-plan-card-slot" data-testid="agent-timeline-plan-card" data-node-id={node.id}>
    <PlanApprovalCard />
  </div>
);
