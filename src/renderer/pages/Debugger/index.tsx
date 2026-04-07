import React from 'react';
import { AgentChat } from '../../components/AgentChat';
import { PlanIntakePanel } from '../../components/PlanIntakePanel';
import './Debugger.css';

export const DebuggerPage: React.FC = () => {
  return (
    <div className="debugger-page">
      <AgentChat />
      <PlanIntakePanel />
    </div>
  );
};

export default DebuggerPage;
