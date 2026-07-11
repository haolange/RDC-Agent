import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextKind,
  ProgressTask,
  TraceArtifactRecord,
  TraceContextRecord,
} from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useI18n, type TranslationKey } from '../../../i18n';
import { useProjectStore } from '../../../stores/projectStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { Button } from '../../../ui/Button';
import { SessionContextPanel } from './SessionContextPanel';
import { TraceProgressMarker } from './TraceProgressMarker';
import { TraceRequestInspectorSection } from './TraceRequestInspectorSection';

type SectionId = 'progress' | 'artifacts' | 'context' | 'requestInspector';

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

/** 将「进度」任务点击定位到聊天区 Work Process 中对应任务行（滚动 + 高亮闪烁）。 */
const focusWorkProcessTask = (taskId: string): void => {
  if (typeof document === 'undefined') return;
  const escaped = window.CSS && typeof window.CSS.escape === 'function' ? window.CSS.escape(taskId) : taskId;
  const target = document.querySelector<HTMLElement>(`[data-work-process-task-id="${escaped}"]`)
    ?? document.querySelector<HTMLElement>('[data-work-process-block-id="runtime-tasks"]');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('is-trace-flash');
  window.setTimeout(() => target.classList.remove('is-trace-flash'), 1600);
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

const ProgressList: React.FC<{
  current: ProgressTask[];
  history: ProgressTask[];
  onFocusTask: (taskId: string) => void;
}> = ({ current, history, onFocusTask }) => {
  const { t } = useI18n();
  if (current.length === 0 && history.length === 0) {
    return <p className="trace-lane-empty">{t('control.traceEmptyProgress')}</p>;
  }

  const renderRow = (task: ProgressTask, index: number) => {
    const label = task.status === 'running' && task.activeForm ? task.activeForm : task.title;
    return (
      <li
        key={`${task.traceLaneId}:${task.id}`}
        className={`trace-progress-item status-${task.status}`}
        data-testid="trace-progress-item"
      >
        <button
          type="button"
          className="trace-progress-row"
          onClick={() => onFocusTask(task.id)}
          title={t('control.traceProgressJump')}
        >
          <TraceProgressMarker status={task.status} index={index} />
          <span className="trace-progress-body">
            <span className="trace-progress-title">{label}</span>
            {task.status === 'blocked' && task.blockerSummary ? (
              <span className="trace-progress-blocker">
                {t('control.traceBlockedBy', { titles: task.blockerSummary })}
              </span>
            ) : null}
          </span>
          <span className="trace-progress-time">{formatTime(task.updatedAt)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="trace-progress">
      {current.length > 0 ? (
        <ol className="trace-progress-list">
          {current.map((task, index) => renderRow(task, index + 1))}
        </ol>
      ) : null}
      {history.length > 0 ? (
        <details className="trace-progress-history" open={current.length === 0}>
          <summary>{t('control.traceCompletedTasks', { count: history.length })}</summary>
          <ol className="trace-progress-list is-history">
            {history.map((task, index) => renderRow(task, index + 1))}
          </ol>
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
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    progress: true,
    artifacts: true,
    context: true,
    requestInspector: false,
  });
  const lastSessionId = useRef<string | null>(null);

  useEffect(() => {
    const nextSessionId = currentSession?.sessionId ?? null;
    if (nextSessionId === lastSessionId.current) return;
    lastSessionId.current = nextSessionId;
    setExpanded({ progress: true, artifacts: true, context: true, requestInspector: false });
  }, [currentSession?.sessionId]);

  const rightPanel = presentation?.rightPanel ?? null;
  const progressStats = useMemo(() => {
    const currentTasks = rightPanel?.progress.current ?? [];
    const historyTasks = rightPanel?.progress.history ?? [];
    return {
      total: currentTasks.length + historyTasks.length,
      done: historyTasks.length,
      blocked: currentTasks.filter((task) => task.status === 'blocked').length,
    };
  }, [rightPanel?.progress.current, rightPanel?.progress.history]);
  const focusTask = useCallback((taskId: string) => focusWorkProcessTask(taskId), []);
  const visibleContextGroups = useMemo(
    () =>
      (rightPanel?.context.groups ?? [])
        .map((group) => ({ kind: group.kind, records: group.important }))
        .filter((group) => group.records.length > 0),
    [rightPanel?.context.groups],
  );
  const toggle = (sectionId: SectionId) => {
    setExpanded((state) => ({ ...state, [sectionId]: !state[sectionId] }));
  };

  return (
    <div className="control-panel">
      <div className="cp-content scrollbar-thin">
        <Section
          id="progress"
          title={t('control.traceProgress')}
          expanded={expanded.progress}
          onToggle={() => toggle('progress')}
          summary={progressStats.total > 0 ? (
            <span className="trace-progress-summary">
              {progressStats.blocked > 0 ? (
                <span className="trace-progress-summary-blocked">{t('control.traceBlockedCount', { count: progressStats.blocked })}</span>
              ) : null}
              <span className="cp-section-summary-main trace-progress-summary-count">{t('control.traceProgressCount', { done: progressStats.done, total: progressStats.total })}</span>
            </span>
          ) : undefined}
        >
          <ProgressList
            current={rightPanel?.progress.current ?? []}
            history={rightPanel?.progress.history ?? []}
            onFocusTask={focusTask}
          />
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
        >
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
        <TraceRequestInspectorSection
          expanded={expanded.requestInspector}
          onToggle={() => toggle('requestInspector')}
        />
      </div>
    </div>
  );
};

export default TraceRightPanel;


