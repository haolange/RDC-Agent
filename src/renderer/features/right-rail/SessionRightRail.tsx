import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { useWorkflowStore } from '../../stores/workflowStore';
import { Icon } from '../../ui/Icon';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { CapturePanel } from './CapturePanel';
import { RightRailArtifactList } from './RightRailArtifactList';
import { RightRailContext } from './RightRailContext';
import { RightRailEmptyState as EmptyState } from './RightRailEmptyState';
import { RightRailOutputList } from './RightRailOutputList';
import { RightRailTaskList } from './RightRailTaskList';
import type { RdcContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';

type RailTab = 'tasks' | 'artifacts' | 'outputs' | 'context' | 'capture';

const RailSection: React.FC<{ id: RailTab; title: string; populated?: boolean; meta?: string; children: React.ReactNode }> = ({ id, title, populated = false, meta, children }) => (
  <section className={`right-rail-section${populated ? ' is-populated' : ''}`} data-testid={`right-rail-${id}`}>
    <h2 className="right-rail-section-heading">{title}{meta ? <span className="right-rail-section-meta">{meta}</span> : null}</h2>
    <div className="right-rail-section-content">{children}</div>
  </section>
);

/**
 * The session inspector: one tab bar over Tasks / Artifacts / Outputs / Context / Capture, showing one
 * section at a time so an empty session is one quiet panel rather than five stacked placeholders.
 */
export const SessionRightRail: React.FC = () => {
  const { t } = useI18n();
  const [tab, setTab] = useState<RailTab>('tasks');
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const rightPanel = presentation?.rightPanel;
  const tasks = rightPanel?.tasks ?? [];
  const artifacts = rightPanel?.artifacts ?? { rows: [], totalCount: 0, storeDegraded: false };
  const outputs = rightPanel?.outputs ?? { current: [], previous: [] };
  const taskContext: TaskContextPanelViewModel | undefined = rightPanel?.context?.task;
  const captureContext: RdcContextPanelViewModel | undefined = rightPanel?.context?.rdc;
  const hasArtifacts = artifacts.totalCount > 0;
  const outputCount = outputs.current.length + outputs.previous.length;
  const hasTaskContext = Boolean(taskContext?.resources.length);
  const hasCapture = Boolean(taskContext && captureContext && captureContext.availableCaptures.length);
  const taskSessionId = tasks[0]?.sessionId ?? 'no-session';
  const taskCount = tasks.length
    ? t('control.rightRail.tasks.count', { done: tasks.filter(task => task.status === 'completed').length, total: tasks.length })
    : undefined;

  const tabs = [
    { id: 'tasks', label: t('control.rightRail.tasks.title'), icon: <Icon name="tasks" />, count: tasks.length },
    { id: 'artifacts', label: t('control.rightRail.artifacts.title'), icon: <Icon name="artifact" />, count: artifacts.totalCount },
    { id: 'outputs', label: t('control.rightRail.outputs.title'), icon: <Icon name="output" />, count: outputCount },
    { id: 'context', label: t('control.rightRail.context.title'), icon: <Icon name="layers" /> },
    { id: 'capture', label: t('control.rightRail.capture.title'), icon: <Icon name="capture" /> },
  ] satisfies Array<TabItem & { id: RailTab }>;

  const panel = (() => {
    switch (tab) {
      case 'tasks':
        return (
          <RailSection id="tasks" populated={tasks.length > 0} meta={taskCount} title={t('control.rightRail.tasks.title')}>
            {tasks.length ? (
              <RightRailTaskList key={taskSessionId} tasks={tasks} locateLabel={t('control.rightRail.locateTask')} />
            ) : <EmptyState kind="tasks" copy={t('control.rightRail.tasks.empty')} />}
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
        label={t('control.rightRail.inspector')} fullWidth collapsible>
        {panel}
      </Tabs>
    </aside>
  );
};
