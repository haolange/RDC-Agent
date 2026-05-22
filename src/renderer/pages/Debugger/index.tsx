import React from 'react';
import type { AgentMode } from '@shared/types/layout';
import { AgentChat } from '../../features/debugger/AgentChat';
import './Debugger.css';

export const DebuggerPage: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  return (
    <div className="debugger-page" data-testid={`${mode}-workbench-page`}>
      <AgentChat mode={mode} />
    </div>
  );
};

export default DebuggerPage;
