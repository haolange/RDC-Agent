import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { isTrackActivity, isProcessTrackRow } from './workProcessTrack';

export const WorkProcessTrackContext = React.createContext<string | undefined>(undefined);

export const WorkProcessRailIcon: React.FC<{ row: WorkProcessRow; active?: boolean }> = ({ row, active }) => {
  const firstId = React.useContext(WorkProcessTrackContext);
  const structural = isProcessTrackRow(row) && (row.type === 'section' || (row.id === firstId && row.type !== 'tool'));
  if (!structural) return null;
  const running = active ?? isTrackActivity(row);
  return <span className="work-process-event-anchor" data-work-anchor={row.id}
    data-work-node={running ? 'activity' : 'structure'} aria-hidden="true">
    <span className={`work-process-rail-marker${running ? ' is-running' : ''}`} />
  </span>;
};
