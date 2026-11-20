import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { useWorkflowStore } from '../../stores/workflowStore';
import { Tabs } from '../../ui/Tabs';
import { CapturePanel } from './CapturePanel';
import { RightRailArtifactList } from './RightRailArtifactList';
import { RightRailContext } from './RightRailContext';
import { RightRailEmptyState as EmptyState } from './RightRailEmptyState';
import { RightRailOutputList } from './RightRailOutputList';
import { RightRailProgressList } from './RightRailProgressList';
import type { RdcContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';

type RailTab = 'progress' | 'artifacts' | 'outputs' | 'context' | 'capture';

const RailSection: React.FC<{ id: RailTab; title: string; populated?: boolean; meta?: string; children: React.ReactNode }> = ({ id, title, populated = false, meta, children }) => (
  <section className={`right-rail-section${populated ? ' is-populated' : ''}`} data-testid={`right-rail-${id}`}>
    <h2 className="right-rail-section-heading">{title}{meta ? <span className="right-rail-section-meta">{meta}</span> : null}</h2>
    <div className="right-rail-section-content">{children}</div>
  </section>
);

const TabLabel: React.FC<{ title: string; count?: string }> = ({ title, count }) => (
  <span className="right-rail-tab-label">{title}{count ? <span className="right-rail-tab-count">{count}</span> : null}</span>
);

/**
 * The session inspector: one tab bar over Progress / Artifacts / Outputs / Context / Capture, showing one
 * section at a time so an empty session is one quiet panel rather than five stacked placeholders.
 */
export const SessionRightRail: React.FC = () => {
  const { t } = useI18n();
  const [tab, setTab] = useState<RailTab>('progress');
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const rightPanel = presentation?.rightPanel;
  const tasks = rightPanel?.progress ?? [];
  const artifacts = rightPanel?.artifacts ?? { rows: [], totalCount: 0, storeDegraded: false };
  const outputs = rightPanel?.outputs ?? { current: [], previous: [] };
  const taskContext: TaskContextPanelViewModel | undefined = rightPanel?.context?.task;
  const captureContext: RdcContextPanelViewModel | undefined = rightPanel?.context?.rdc;
  const hasArtifacts = artifacts.totalCount > 0;
  const outputCount = outputs.current.length + outputs.previous.length;
  const hasTaskContext = Boolean(taskContext?.resources.length);
  const hasCapture = Boolean(taskContext && captureContext && captureContext.availableCaptures.length);
  const progressSessionId = tasks[0]?.sessionId ?? 'no-session';
  const progressCount = tasks.length
    ? t('control.traceProgressCount', { done: tasks.filter(task => task.status === 'completed').length, total: tasks.length })
    : undefined;

  const tabs = [
    { id: 'progress', label: <TabLabel title={t('control.rightRail.progress.title')} count={progressCount} /> },
    { id: 'artifacts', label: <TabLabel title={t('control.rightRail.artifacts.title')} count={hasArtifacts ? String(artifacts.totalCount) : undefined} /> },
    { id: 'outputs', label: <TabLabel title={t('control.rightRail.outputs.title')} count={outputCount ? String(outputCount) : undefined} /> },
    { id: 'context', label: <TabLabel title={t('control.rightRail.context.title')} /> },
    { id: 'capture', label: <TabLabel title={t('control.rightRail.capture.title')} /> },
  ] satisfies Array<{ id: RailTab; label: React.ReactNode }>;

  const panel = (() => {
    switch (tab) {
      case 'progress':
        return (
          <RailSection id="progress" populated={tasks.length > 0} meta={progressCount} title={t('control.rightRail.progress.title')}>
            {tasks.length ? (
              <RightRailProgressList key={progressSessionId} tasks={tasks} locateLabel={t('control.rightRail.locateTask')} />
            ) : <EmptyState kind="progress" copy={t('control.rightRail.progress.empty')} />}
          </RailSection>
        );
      case 'artifacts':
        return (
          <RailSection id="artifacts" title={t('control.rightRail.artifacts.title')}>
            {hasArtifacts ? <RightRailArtifactList artifacts={artifacts} /> : (
              <EmptyState kind="artifacts" copy={artifacts.storeDegraded
                ? t('control.rightRail.artifacts.storeDegraded')
                : t('control.rightRail.artifacts.empty')} />
            )}
          </RailSection>
        );
      case 'outputs':
        return (
          <RailSection id="outputs" title={t('control.rightRail.outputs.title')}>
            {outputCount
              ? <RightRailOutputList current={outputs.current} previous={outputs.previous} />
              : <EmptyState kind="outputs" copy={t('control.rightRail.outputs.empty')} />}
          </RailSection>
        );
      case 'context':
        return (
          <RailSection id="context" title={t('control.rightRail.context.title')}>
            {hasTaskContext && taskContext
              ? <RightRailContext task={taskContext} />
              : <EmptyState kind="context" copy={t('control.rightRail.context.empty')} />}
          </RailSection>
        );
      case 'capture':
        return hasCapture && taskContext && captureContext ? (
          <section className="right-rail-section" data-testid="right-rail-capture">
            <CapturePanel task={taskContext} capture={captureContext} />
          </section>
        ) : (
          <RailSection id="capture" title={t('control.rightRail.capture.title')}>
            <EmptyState kind="capture" copy={t('control.rightRail.capture.empty')} />
          </RailSection>
        );
    }
  })();

  return (
    <aside className="right-rail" aria-label={t('control.rightRail.inspector')}>
      <Tabs className="right-rail-tabs" tabs={tabs} value={tab} onChange={(id) => setTab(id as RailTab)}
        label={t('control.rightRail.inspector')} fullWidth>
        {panel}
      </Tabs>
    </aside>
  );
};
