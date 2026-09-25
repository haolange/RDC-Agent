import React from 'react';
import type { WorkProcessPresentation } from './workProcessTypes';
import type { WorkProcessRow } from './workProcessTypes';
import { createWorkProcessRowRenderer } from './workProcessRowRenderer';
import { MeasuredWorkRows } from './MeasuredWorkRows';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';

/** The same process body is used by the parent Working Process and an opened delegation. */
export const WorkProcessContent: React.FC<{
  presentation: WorkProcessPresentation;
  sessionId?: string | null;
  renderToolDetail?: (row: Extract<WorkProcessRow, { type: 'tool' }>) => React.ReactNode;
  disclosureScope?: string;
  density?: 'normal' | 'compact';
  /** The enclosing disclosure already supplies the leading content inset. */
  embedded?: boolean;
}> = ({ presentation, sessionId, renderToolDetail, disclosureScope, embedded = false, density = 'normal' }) => {
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
    {presentation.rows.length > 0 ? <MeasuredWorkRows className="work-process-steps work-process-narrative-stream"
      rows={presentation.rows} renderRow={renderRow} /> : null}
  </div></ScopedWorkDisclosure>;
};
