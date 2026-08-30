import React from 'react';
import type { ProgressTask, RdxContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { CapturePanel } from './CapturePanel';
import { RightRailContext } from './RightRailContext';
import { RightRailEmptyState as EmptyState } from './RightRailEmptyState';
import { TaskStatusMarker } from '../../../ui/TaskStatusMarker';
import { TraceArtifactList } from './TraceArtifactList';

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

const RailSection: React.FC<{ id: 'progress' | 'outputs' | 'context' | 'capture'; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className="right-rail-section" data-testid={`right-rail-${id}`}>
    <h2 className="right-rail-section-heading">{title}</h2>
    <div className="right-rail-section-content">{children}</div>
  </section>
);

const ProgressList: React.FC<{ tasks: ProgressTask[] }> = ({ tasks }) => (
  <ol className="right-rail-progress">
    {tasks.map((task) => (
      <li key={task.id} className={`right-rail-task-row status-${task.status}`}>
        <button type="button" onClick={() => focusWorkProcessTask(task.id)} title="Locate in Work Process">
          <TaskStatusMarker status={task.status} order={task.order} />
          <span className="right-rail-task-copy"><strong>{task.title}</strong>{task.blockerSummary ? <small>{task.blockerSummary}</small> : null}</span>
        </button>
      </li>
    ))}
  </ol>
);

export const TraceRightPanel: React.FC = () => {
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const rightPanel = presentation?.rightPanel;
  const tasks = rightPanel?.progress ?? [];
  const outputs = rightPanel?.artifacts ?? { current: [], previous: [] };
  const taskContext: TaskContextPanelViewModel | undefined = rightPanel?.context?.task;
  const captureContext: RdxContextPanelViewModel | undefined = rightPanel?.context?.rdx;
  const hasOutputs = outputs.current.length + outputs.previous.length > 0;
  const hasTaskContext = Boolean(taskContext?.resources.length);
  const hasCapture = Boolean(taskContext && captureContext && (captureContext.capture || captureContext.availableCaptures.length || captureContext.diagnostics.length));

  return (
    <aside className="right-rail" aria-label="Session inspector">
      <RailSection id="progress" title="Progress">{tasks.length ? <ProgressList tasks={tasks} /> : <EmptyState kind="progress" copy="Steps will show as the task unfolds." />}</RailSection>
      <RailSection id="outputs" title="Outputs">{hasOutputs ? <TraceArtifactList current={outputs.current} previous={outputs.previous} /> : <EmptyState kind="outputs" copy="Outputs created during this task appear here." />}</RailSection>
      <RailSection id="context" title="Context">{hasTaskContext && taskContext ? <RightRailContext task={taskContext} /> : <EmptyState kind="context" copy="Tools and referenced files used in this task appear here." />}</RailSection>
      <RailSection id="capture" title="Capture">{hasCapture && taskContext && captureContext ? <CapturePanel task={taskContext} capture={captureContext} /> : <EmptyState kind="capture" copy="Import a .rdc file to this project to open and preview it here." />}</RailSection>
    </aside>
  );
};

export default TraceRightPanel;
