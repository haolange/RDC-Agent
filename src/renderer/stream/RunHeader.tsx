import React from 'react';
import type { AgentRun } from '@shared/types/agenticTrace';

export const RunHeader: React.FC<{ run: AgentRun }> = ({ run }) => (
  <header className="trace-run-header" data-testid="trace-run-header">
    <span className={`trace-run-status status-${run.status}`}>{run.status}</span>
    <h3>{run.title || run.userRequest.slice(0, 80)}</h3>
    <span className="trace-run-type">{run.agentType}</span>
  </header>
);
