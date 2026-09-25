import React from 'react';

/** Only a running loop is implied. No proportional progress is inferred from elapsed time. */
export const SubagentProgressDots: React.FC<{ state: 'active' | 'complete' | 'stopped' }> = ({ state }) => (
  <span className={`work-process-subagent-dots is-${state}`} aria-hidden="true">
    {Array.from({ length: 24 }, (_, index) => <span key={index} />)}
  </span>
);
