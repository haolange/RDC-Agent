import React from 'react';
import type { AgentMode } from '@shared/types/layout';
import { AgentChat } from '../../components/AgentChat';
import { PlanIntakePanel } from '../../components/PlanIntakePanel';
import './Debugger.css';

export const DebuggerPage: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  return (
    <div className="debugger-page" data-testid={`${mode}-workbench-page`}>
      <AgentChat mode={mode} />
      <PlanIntakePanel />
    </div>
  );
};

export default DebuggerPage;
