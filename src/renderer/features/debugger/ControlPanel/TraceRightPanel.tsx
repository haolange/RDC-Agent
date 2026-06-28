import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextKind,
  ProgressTask,
  TraceArtifactRecord,
  TraceContextRecord,
} from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useI18n, type TranslationKey } from '../../../i18n';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { Button } from '../../../ui/Button';
import { SessionContextPanel } from './SessionContextPanel';
import { hasApprovedTaskBoardState, TaskBoard } from './TaskBoard';

type SectionId = 'progress' | 'artifacts' | 'context';

const kindLabelKey: Record<ContextKind, TranslationKey> = {
  capture: 'control.traceKindCapture',
  file: 'control.traceKindFile',
  source: 'control.traceKindSource',
  capability: 'control.traceKindCapability',
};

const formatTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const Section: React.FC<{
  id: SectionId;
  title: string;
  summary?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ id, title, summary, expanded, onToggle, children }) => (
  <div className={`cp-section cp-section-session ${expanded ? 'expanded' : ''}`} data-testid={`cp-section-trace-lane-${id}`}>
    <button className="cp-section-header" onClick={onToggle} aria-expanded={expanded}>
      <div className="cp-section-title">
        <span className="cp-section-label">{title}</span>
      </div>
      <div className="cp-section-trailing">
        {summary ? <div className="cp-section-summary">{summary}</div> : null}
        <span className={`cp-section-arrow ${expanded ? 'expanded' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
    </button>
    {expanded ? <div className="cp-section-content"><div className="cp-section-inner">{children}</div></div> : null}
  </div>
);

const ProgressList: React.FC<{ current: ProgressTask[]; history: ProgressTask[] }> = ({ current, history }) => {
  const { t } = useI18n();
  if (current.length === 0 && history.length === 0) {
    return <p className="trace-lane-empty">{t('control.traceEmptyProgress')}</p>;
  }
  const renderTask = (task: ProgressTask) => (
    <div key={`${task.traceLaneId}:${task.id}`} className={`trace-lane-progress-item status-${task.status}`}>
      <span className="trace-lane-progress-status">{task.status}</span>
      <span className="trace-lane-progress-title">{task.title}</span>
      <span className="trace-lane-progress-time">{formatTime(task.updatedAt)}</span>
      {task.blockerSummary ? <p>{task.blockerSummary}</p> : null}
    </div>
  );

  return (
    <div className="trace-lane-progress-list">
      {current.map(renderTask)}
      {history.length > 0 ? (
        <details className="trace-lane-history" open={current.length === 0}>
          <summary>{t('control.tracePreviousTasks', { count: history.length })}</summary>
          {history.map(renderTask)}
        </details>
      ) : null}
    </div>
  );
};

const ArtifactList: React.FC<{ current: TraceArtifactRecord[]; previous: TraceArtifactRecord[] }> = ({ current, previous }) => {
  const { t } = useI18n();
  if (current.length === 0 && previous.length === 0) {
    return <p className="trace-lane-empty">{t('control.traceEmptyArtifacts')}</p>;
  }
  const renderArtifact = (artifact: TraceArtifactRecord) => (
    <div key={artifact.id} className={`trace-lane-artifact-item status-${artifact.status}`}>
      <div className="trace-lane-artifact-main">
        <span className="trace-lane-artifact-name">{artifact.displayName}</span>
        <span className="trace-lane-artifact-meta">{artifact.type} · {artifact.taskTitle || artifact.traceLaneId}</span>
      </div>
      <div className="trace-lane-artifact-actions">
        <Button variant="ghost" size="sm" onClick={() => artifact.path && void getElectronApi()?.appShell.openPath(artifact.path)}>{t('control.traceArtifactOpen')}</Button>
        <Button variant="ghost" size="sm" onClick={() => artifact.path && void getElectronApi()?.appShell.copyText(artifact.path)}>{t('control.traceArtifactCopyPath')}</Button>
        <Button variant="ghost" size="sm" title={artifact.rawRef}>{t('control.traceArtifactRaw')}</Button>
      </div>
    </div>
  );

  return (
    <div className="trace-lane-artifact-list">
      {current.map(renderArtifact)}
      {previous.length > 0 ? (
        <details className="trace-lane-history">
          <summary>{t('control.tracePreviousTasks', { count: previous.length })}</summary>
          {previous.map(renderArtifact)}
        </details>
      ) : null}
    </div>
  );
};

const ContextList: React.FC<{ records: TraceContextRecord[] }> = ({ records }) => (
  <div className="trace-lane-context-list">
    {records.map((record) => (
      <div key={record.id} className={`trace-lane-context-item importance-${record.importance}`}>
        <span className="trace-lane-context-label">{record.label}</span>
        <span className="trace-lane-context-importance">{record.importance}</span>
        {record.summary ? <p>{record.summary}</p> : null}
      </div>
    ))}
  </div>
);

export const TraceRightPanel: React.FC = () => {
  const { t } = useI18n();
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const showTaskBoard = hasApprovedTaskBoardState(
    currentRun,
    workflowState,
  );
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    progress: true,
    artifacts: true,
    context: true,
  });
  const [showAllContext, setShowAllContext] = useState(false);
  const lastSessionId = useRef<string | null>(null);

  useEffect(() => {
    const sessionId = currentSession?.sessionId ?? null;
    if (sessionId === lastSessionId.current) return;
    lastSessionId.current = sessionId;
    setExpanded({ progress: true, artifacts: true, context: true });
    setShowAllContext(false);
  }, [currentSession?.sessionId]);

  const rightPanel = presentation?.rightPanel ?? null;
  const progressSummary = useMemo(() => {
    const currentCount = rightPanel?.progress.current.length ?? 0;
    const historyCount = rightPanel?.progress.history.length ?? 0;
    if (currentCount > 0) return t('control.traceProgressActive', { count: currentCount });
    if (historyCount > 0) return t('control.traceProgressDone', { count: historyCount });
    return undefined;
  }, [rightPanel?.progress.current.length, rightPanel?.progress.history.length, t]);
  const visibleContextGroups = useMemo(
    () =>
      (rightPanel?.context.groups ?? [])
        .map((group) => ({ kind: group.kind, records: showAllContext ? group.all : group.important }))
        .filter((group) => group.records.length > 0),
    [rightPanel?.context.groups, showAllContext],
  );
  const toggle = (sectionId: SectionId) => {
    setExpanded((state) => ({ ...state, [sectionId]: !state[sectionId] }));
  };

  const exportSession = (includeRawTrace: boolean) => {
    const sessionId = currentSession?.sessionId;
    if (!sessionId) return;
    void getElectronApi()?.trace.exportSession(sessionId, {
      includeAllBranches: true,
      includeRawTrace,
    });
  };

  return (
    <div className="control-panel">
      <div className="cp-content scrollbar-thin">
        <div className="trace-lane-export-actions" data-testid="trace-lane-export-actions">
          <Button variant="ghost" size="sm" onClick={() => exportSession(false)}>{t('control.traceExportSummary')}</Button>
          <Button variant="ghost" size="sm" onClick={() => exportSession(true)}>{t('control.traceExportRawTrace')}</Button>
        </div>
        {showTaskBoard ? <TaskBoard /> : null}
        <Section
          id="progress"
          title={t('control.traceProgress')}
          expanded={expanded.progress}
          onToggle={() => toggle('progress')}
          summary={progressSummary ? <span className="cp-section-summary-main">{progressSummary}</span> : undefined}
        >
          <ProgressList current={rightPanel?.progress.current ?? []} history={rightPanel?.progress.history ?? []} />
        </Section>
        <Section
          id="artifacts"
          title={t('control.traceArtifacts')}
          expanded={expanded.artifacts}
          onToggle={() => toggle('artifacts')}
          summary={rightPanel?.artifacts.current.length ? <span className="cp-section-summary-main">{t('control.traceArtifactsReady', { count: rightPanel.artifacts.current.length })}</span> : undefined}
        >
          <ArtifactList current={rightPanel?.artifacts.current ?? []} previous={rightPanel?.artifacts.previous ?? []} />
        </Section>
        <Section
          id="context"
          title={t('control.traceContext')}
          expanded={expanded.context}
          onToggle={() => toggle('context')}
          summary={<span className="cp-section-summary-main">{showAllContext ? t('control.traceContextAll') : t('control.traceContextImportant')}</span>}
        >
          <div className="trace-lane-context-toggle">
            <Button variant="ghost" size="sm" onClick={() => setShowAllContext((value) => !value)}>
              {showAllContext ? t('control.traceImportantOnly') : t('control.traceShowAll')}
            </Button>
          </div>
          {visibleContextGroups.length === 0 ? (
            <p className="trace-lane-empty">{t('control.traceEmptyContext')}</p>
          ) : (
            visibleContextGroups.map((group) => (
              <section key={group.kind} className="trace-lane-context-group">
                <h3>{t(kindLabelKey[group.kind])}</h3>
                <ContextList records={group.records} />
              </section>
            ))
          )}
          <SessionContextPanel />
        </Section>
      </div>
    </div>
  );
};

export default TraceRightPanel;


