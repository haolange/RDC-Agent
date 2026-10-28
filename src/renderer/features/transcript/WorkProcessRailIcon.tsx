import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { hasTrackNarrative, isTrackActivity } from './workProcessTrack';

export const WorkProcessTrackContext = React.createContext<string | undefined>(undefined);

export const WorkProcessRailIcon: React.FC<{ row: WorkProcessRow; active?: boolean }> = ({ row, active }) => {
  const firstId = React.useContext(WorkProcessTrackContext);
  const narrative = row.type === 'section' && hasTrackNarrative(row);
  if (row.type === 'section' && !narrative) return null;
  const running = active ?? isTrackActivity(row);
  const structural = row.id === firstId || narrative;
  return <span className="work-process-event-anchor" data-work-anchor={row.id}
    data-work-node={running ? 'activity' : structural ? 'structure' : undefined} aria-hidden="true">
    {running || structural ? <span className={`work-process-rail-marker${running ? ' is-running' : ''}`} /> : null}
  </span>;
};
