import React from 'react';
import type { ProgressTask, RdxContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { useI18n } from '../../i18n';
import { useWorkflowStore } from '../../stores/workflowStore';
import { CapturePanel } from './CapturePanel';
import { RightRailArtifactList } from './RightRailArtifactList';
import { RightRailContext } from './RightRailContext';
import { RightRailEmptyState as EmptyState } from './RightRailEmptyState';
import { RightRailOutputList } from './RightRailOutputList';
import { TaskStatusMarker } from '../../ui/TaskStatusMarker';

const focusWorkProcessTask = (taskId: string): void => {
  const escaped = window.CSS?.escape ? window.CSS.escape(taskId) : taskId;
  const target = document.querySelector<HTMLElement>(`[data-work-process-task-id="${escaped}"]`) ?? document.querySelector<HTMLElement>('[data-work-process-block-id="runtime-tasks"]');
  if (!target) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
  target.classList.remove('is-trace-flash', 'is-trace-flash-static');
  void target.offsetWidth;
  target.classList.add(reduced ? 'is-trace-flash-static' : 'is-trace-flash');
  window.setTimeout(() => target.classList.remove('is-trace-flash', 'is-trace-flash-static'), reduced ? 800 : 1600);
};

const RailSection: React.FC<{ id: 'progress' | 'artifacts' | 'outputs' | 'context' | 'capture'; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className="right-rail-section" data-testid={`right-rail-${id}`}>
    <h2 className="right-rail-section-heading">{title}</h2>
    <div className="right-rail-section-content">{children}</div>
  </section>
);

const ProgressList: React.FC<{ tasks: ProgressTask[]; locateLabel: string }> = ({ tasks, locateLabel }) => (
  <ol className="right-rail-progress">
    {tasks.map((task) => (
      <li key={task.id} className={`right-rail-task-row status-${task.status}`}>
        <button type="button" onClick={() => focusWorkProcessTask(task.id)} title={locateLabel}>
          <TaskStatusMarker status={task.status} order={task.order} />
          <span className="right-rail-task-copy"><strong>{task.title}</strong>{task.blockerSummary ? <small>{task.blockerSummary}</small> : null}</span>
        </button>
      </li>
    ))}
  </ol>
);

export const TraceRightPanel: React.FC = () => {
  const { t } = useI18n();
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const rightPanel = presentation?.rightPanel;
  const tasks = rightPanel?.progress ?? [];
  const artifacts = rightPanel?.artifacts ?? { rows: [], supersededCount: 0, truncatedCount: 0, storeDegraded: false };
  const outputs = rightPanel?.outputs ?? { current: [], previous: [] };
  const taskContext: TaskContextPanelViewModel | undefined = rightPanel?.context?.task;
  const captureContext: RdxContextPanelViewModel | undefined = rightPanel?.context?.rdx;
  const hasArtifacts = artifacts.rows.length + artifacts.supersededCount + artifacts.truncatedCount > 0;
  const hasOutputs = outputs.current.length + outputs.previous.length > 0;
  const hasTaskContext = Boolean(taskContext?.resources.length);
  const hasCapture = Boolean(taskContext && captureContext && (captureContext.capture || captureContext.availableCaptures.length || captureContext.diagnostics.length));

  return (
    <aside className="right-rail" aria-label={t('control.rightRail.inspector')}>
      <RailSection id="progress" title={t('control.rightRail.progress.title')}>{tasks.length ? <ProgressList tasks={tasks} locateLabel={t('control.rightRail.locateTask')} /> : <EmptyState kind="progress" copy={t('control.rightRail.progress.empty')} />}</RailSection>
      <RailSection id="artifacts" title={t('control.rightRail.artifacts.title')}>{hasArtifacts ? <RightRailArtifactList artifacts={artifacts} /> : <EmptyState kind="artifacts" copy={artifacts.storeDegraded ? t('control.rightRail.artifacts.storeDegraded') : t('control.rightRail.artifacts.empty')} />}</RailSection>
      <RailSection id="outputs" title={t('control.rightRail.outputs.title')}>{hasOutputs ? <RightRailOutputList current={outputs.current} previous={outputs.previous} /> : <EmptyState kind="outputs" copy={t('control.rightRail.outputs.empty')} />}</RailSection>
      <RailSection id="context" title={t('control.rightRail.context.title')}>{hasTaskContext && taskContext ? <RightRailContext task={taskContext} /> : <EmptyState kind="context" copy={t('control.rightRail.context.empty')} />}</RailSection>
      <RailSection id="capture" title={t('control.rightRail.capture.title')}>{hasCapture && taskContext && captureContext ? <CapturePanel task={taskContext} capture={captureContext} /> : <EmptyState kind="capture" copy={t('control.rightRail.capture.empty')} />}</RailSection>
    </aside>
  );
};

export default TraceRightPanel;
