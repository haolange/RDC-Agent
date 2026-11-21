import React from 'react';
import { createWorkProcessRowRenderer } from './workProcessRowRenderer';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { WorkProcessViewport } from './WorkProcessViewport';
import { WorkProcessTrackContext } from './WorkProcessRailIcon';
import { firstTrackEvent } from './workProcessTrack';
import { useWorkProcessTrack } from './useWorkProcessTrack';
import type { WorkProcessRow } from './workProcessTypes';
import type { WorkProcessPresentation } from './workProcessTypes';
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
  /** The owning turn or delegation is still running; under the `latest` preference it follows the newest step. */
  active: boolean;
}> = ({ presentation, sessionId, renderToolDetail, disclosureScope, leadingContent, active, embedded = false, density = 'normal' }) => {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const firstId = firstTrackEvent(presentation.rows);
  useWorkProcessTrack(trackRef, firstId);
  const renderRow = React.useMemo(
    () => createWorkProcessRowRenderer(sessionId, renderToolDetail, density),
    [sessionId, renderToolDetail, density],
  );
  const preference = useAppSettingsStore((state) => state.settings.appearance.workProcessExpansion);
  if (!presentation.summary && presentation.rows.length === 0) return null;
  const body = <div className={`work-process-body${embedded ? ' is-embedded' : ''}${density === 'compact' ? ' is-compact' : ''}`}>
    {presentation.summary ? <p className="work-process-summary">{presentation.summary}</p> : null}
    <WorkProcessViewport following={active && preference === 'latest'}>
      <WorkProcessTrackContext.Provider value={firstId}><div ref={trackRef} className="work-process-track" data-work-track="true">
        {leadingContent ? <div className="work-process-track-leading">{leadingContent}</div> : null}
        {presentation.rows.length > 0 ? <MeasuredWorkRows className="work-process-steps work-process-narrative-stream"
          rows={presentation.rows} renderRow={renderRow} /> : null}
      </div></WorkProcessTrackContext.Provider>
    </WorkProcessViewport>
  </div>;
  // The turn's Working supplies its scope above the root disclosure; a delegation brings its own.
  return disclosureScope === undefined ? body : <ScopedWorkDisclosure scope={disclosureScope}>{body}</ScopedWorkDisclosure>;
};
