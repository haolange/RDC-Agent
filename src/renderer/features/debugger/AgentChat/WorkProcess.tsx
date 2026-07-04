import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { useI18n } from '../../../i18n';
import { buildWorkProcessPresentation } from './workProcessPresentation';
import { createWorkProcessRowRenderer } from './workProcessRowRenderer';
import { getDefaultGroupOpen, WorkProcessStepGroupRow } from './WorkProcessStepGroupRow';
import { WorkProcessViewToggle } from './WorkProcessViewToggle';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
}

export const WorkProcess: React.FC<WorkProcessProps> = ({ trace }) => {
  const { t } = useI18n();
  const [detailView, setDetailView] = useState(false);
  const presentation = useMemo(
    () => buildWorkProcessPresentation(trace, { view: detailView ? 'detail' : 'grouped' }),
    [trace, detailView],
  );
  const [expanded, setExpanded] = useState<boolean>(presentation.defaultExpanded);
  const [groupOpenState, setGroupOpenState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (trace.status === 'running' || presentation.important) {
      setExpanded(true);
    }
  }, [trace.status, presentation.important]);

  const renderRow = useMemo(
    () => createWorkProcessRowRenderer(detailView),
    [detailView],
  );

  const handleGroupToggle = useCallback((groupId: string, open: boolean) => {
    setGroupOpenState((prev) => ({ ...prev, [groupId]: open }));
  }, []);

  const headlineCopy = trace.status === 'stopped'
    ? t('chat.workProcessHeadlineStopped')
    : t('chat.workProcessTitle');
  const actionMeta = presentation.actionCount > 0
    ? t('chat.workProcessActions', { count: presentation.actionCount })
    : '';
  const durationMeta = presentation.duration ? t('chat.workProcessDuration', { duration: presentation.duration }) : '';
  const metaParts = [durationMeta, actionMeta].filter(Boolean);
  const hasBody = Boolean(presentation.summary)
    || presentation.groups.length > 0
    || presentation.rows.length > 0;

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label={headlineCopy}
    >
      <div className="work-process-header-row">
        <button
          type="button"
          className="work-process-header"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <span className={`work-process-caret ${expanded ? 'is-open' : ''}`} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <span className={`work-process-status-dot status-${trace.status}`} aria-hidden="true" />
          <span className={`work-process-label status-${trace.status}`}>{headlineCopy}</span>
          {metaParts.length > 0 ? <span className="work-process-meta">{metaParts.join(' · ')}</span> : null}
        </button>
        <WorkProcessViewToggle
          detailView={detailView}
          onToggle={() => setDetailView((prev) => !prev)}
        />
      </div>

      {expanded && hasBody ? (
        <div className="work-process-body">
          {presentation.summary ? (
            <p className="work-process-summary">{presentation.summary}</p>
          ) : null}
          {detailView ? (
            presentation.rows.length > 0 ? (
              <ol className="work-process-steps">
                {presentation.rows.map((row) => renderRow(row))}
              </ol>
            ) : null
          ) : (
            presentation.groups.length > 0 ? (
              <ol className="work-process-steps work-process-grouped-steps">
                {presentation.groups.map((group) => (
                  <WorkProcessStepGroupRow
                    key={group.id}
                    group={group}
                    isOpen={groupOpenState[group.id] ?? getDefaultGroupOpen(group)}
                    onToggle={handleGroupToggle}
                    renderRow={renderRow}
                  />
                ))}
              </ol>
            ) : null
          )}
        </div>
      ) : null}
    </section>
  );
};

export default WorkProcess;
