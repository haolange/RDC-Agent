import React from 'react';
import type { RdcContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { useI18n } from '../../i18n';
import { useWorkflowStore } from '../../stores/workflowStore';
import { CapturePanel } from './CapturePanel';
import { RightRailArtifactList } from './RightRailArtifactList';
import { RightRailContext } from './RightRailContext';
import { RightRailEmptyState as EmptyState } from './RightRailEmptyState';
import { RightRailOutputList } from './RightRailOutputList';
import { RightRailProgressList } from './RightRailProgressList';

const RailSection: React.FC<{ id: 'progress' | 'artifacts' | 'outputs' | 'context' | 'capture'; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className="right-rail-section" data-testid={`right-rail-${id}`}>
    <h2 className="right-rail-section-heading">{title}</h2>
    <div className="right-rail-section-content">{children}</div>
  </section>
);

export const TraceRightPanel: React.FC = () => {
  const { t } = useI18n();
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const rightPanel = presentation?.rightPanel;
  const tasks = rightPanel?.progress ?? [];
  const artifacts = rightPanel?.artifacts ?? { rows: [], supersededCount: 0, truncatedCount: 0, storeDegraded: false };
  const outputs = rightPanel?.outputs ?? { current: [], previous: [] };
  const taskContext: TaskContextPanelViewModel | undefined = rightPanel?.context?.task;
  const captureContext: RdcContextPanelViewModel | undefined = rightPanel?.context?.rdc;
  const hasArtifacts = artifacts.rows.length + artifacts.supersededCount + artifacts.truncatedCount > 0;
  const hasOutputs = outputs.current.length + outputs.previous.length > 0;
  const hasTaskContext = Boolean(taskContext?.resources.length);
  const hasCapture = Boolean(taskContext && captureContext && captureContext.availableCaptures.length);
  const progressSessionId = tasks[0]?.sessionId ?? 'no-session';

  return (
    <aside className="right-rail" aria-label={t('control.rightRail.inspector')}>
      <RailSection id="progress" title={t('control.rightRail.progress.title')}>{tasks.length ? <RightRailProgressList key={progressSessionId} tasks={tasks} locateLabel={t('control.rightRail.locateTask')} stopLabel={t('control.rightRail.stopBackground')} /> : <EmptyState kind="progress" copy={t('control.rightRail.progress.empty')} />}</RailSection>
      <RailSection id="artifacts" title={t('control.rightRail.artifacts.title')}>{hasArtifacts ? <RightRailArtifactList artifacts={artifacts} /> : <EmptyState kind="artifacts" copy={artifacts.storeDegraded ? t('control.rightRail.artifacts.storeDegraded') : t('control.rightRail.artifacts.empty')} />}</RailSection>
      <RailSection id="outputs" title={t('control.rightRail.outputs.title')}>{hasOutputs ? <RightRailOutputList current={outputs.current} previous={outputs.previous} /> : <EmptyState kind="outputs" copy={t('control.rightRail.outputs.empty')} />}</RailSection>
      <RailSection id="context" title={t('control.rightRail.context.title')}>{hasTaskContext && taskContext ? <RightRailContext task={taskContext} /> : <EmptyState kind="context" copy={t('control.rightRail.context.empty')} />}</RailSection>
      <>{hasCapture && taskContext && captureContext ? <section className="right-rail-section" data-testid="right-rail-capture"><CapturePanel task={taskContext} capture={captureContext} /></section> : <RailSection id="capture" title={t('control.rightRail.capture.title')}><EmptyState kind="capture" copy={t('control.rightRail.capture.empty')} /></RailSection>}</>
    </aside>
  );
};

export default TraceRightPanel;
