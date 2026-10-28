import React from 'react';
import type { WorkProcessPresentation } from './workProcessTypes';
import type { WorkProcessRow } from './workProcessTypes';
import { createWorkProcessRowRenderer } from './workProcessRowRenderer';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkProcessTrackContext } from './WorkProcessRailIcon';
import { firstTrackEvent } from './workProcessTrack';
import { useWorkProcessTrack } from './useWorkProcessTrack';
import './work-process-track.css';

/** The same process body is used by the parent Working Process and an opened delegation. */
export const WorkProcessContent: React.FC<{
  presentation: WorkProcessPresentation;
  sessionId?: string | null;
  renderToolDetail?: (row: Extract<WorkProcessRow, { type: 'tool' }>) => React.ReactNode;
  disclosureScope?: string;
  density?: 'normal' | 'compact';
  /** The enclosing disclosure already supplies the leading content inset. */
  embedded?: boolean;
  leadingContent?: React.ReactNode;
}> = ({ presentation, sessionId, renderToolDetail, disclosureScope, leadingContent, embedded = false, density = 'normal' }) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const firstId = firstTrackEvent(presentation.rows);
  useWorkProcessTrack(trackRef, firstId);
  const latestTaskSnapshotId = React.useMemo(() => {
    let latest: string | undefined;
    const visit = (rows: WorkProcessRow[]) => {
      for (const row of rows) {
        if (row.type === 'taskSnapshot') latest = row.id;
        else if (row.type === 'section') visit(row.visibleSteps);
      }
    };
    visit(presentation.rows);
    return latest;
  }, [presentation.rows]);
  const renderRow = React.useMemo(
    () => createWorkProcessRowRenderer(sessionId, renderToolDetail, density, latestTaskSnapshotId),
    [sessionId, renderToolDetail, density, latestTaskSnapshotId],
  );
  if (!presentation.summary && presentation.rows.length === 0) return null;
  return <ScopedWorkDisclosure scope={disclosureScope}><div className={`work-process-body${embedded ? ' is-embedded' : ''}${density === 'compact' ? ' is-compact' : ''}`}>
    {presentation.summary ? <p className="work-process-summary">{presentation.summary}</p> : null}
    <WorkProcessTrackContext.Provider value={firstId}><div ref={trackRef} className="work-process-track" data-work-track="true">
      {leadingContent ? <div className="work-process-track-leading">{leadingContent}</div> : null}
      {presentation.rows.length > 0 ? <MeasuredWorkRows className="work-process-steps work-process-narrative-stream"
        rows={presentation.rows} renderRow={renderRow} /> : null}
    </div></WorkProcessTrackContext.Provider>
  </div></ScopedWorkDisclosure>;
};
