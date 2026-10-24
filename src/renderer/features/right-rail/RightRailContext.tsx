import React, { useState } from 'react';
import { TaskDialog } from '../../ui/TaskDialog';
import type { TaskContextPanelViewModel, TaskContextResource } from '@shared/types/trace';
import { openAppPath } from '../../hooks/appShellBridge';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';

const ResourceMark: React.FC<{ resource: TaskContextResource }> = ({ resource }) => {
  if (resource.kind === 'directory') {
    return <svg viewBox="0 0 16 16"><path d="M2.5 4.5h4l1.2 1.4h5.8v6.6h-11z" /></svg>;
  }
  if (resource.kind === 'mcp') {
    return <svg viewBox="0 0 16 16"><circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="8" cy="12" r="1.5" /><path d="M5.3 4.8 7.3 10M10.7 4.8 8.7 10M5.5 4h5" /></svg>;
  }
  if (resource.kind === 'web') {
    return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M2.8 8h10.4M8 2.5c2.2 2.3 2.2 8.7 0 11M8 2.5c-2.2 2.3-2.2 8.7 0 11" /></svg>;
  }
  if (resource.kind === 'skill') {
    return <svg viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6.2 9h3.6M6.2 11h2.6" /></svg>;
  }
  if (resource.kind === 'attachment') {
    return <svg viewBox="0 0 16 16"><path d="M5.5 8.8 9.8 4.5a2 2 0 0 1 2.8 2.8L7.4 12.5a3 3 0 0 1-4.2-4.2l5-5" /></svg>;
  }
  return <svg viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" /></svg>;
};

const ResourceRow: React.FC<{ resource: TaskContextResource; select: (resource: TaskContextResource) => void }> = ({ resource, select }) => (
  <Button variant="ghost" className="right-rail-compact-row" title={resource.label} onClick={() => select(resource)}>
    <span className="right-rail-compact-icon" aria-hidden="true"><ResourceMark resource={resource} /></span>
    <span className="right-rail-compact-title">{resource.label}</span><span aria-hidden="true">›</span>
  </Button>
);

function ScopedContext({ task }: { task: TaskContextPanelViewModel }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const [visible, setVisible] = useState(50);
  const [detail, setDetail] = useState<TaskContextResource | null>(null);
  const [error, setError] = useState(false);
  const select = (resource: TaskContextResource) => {
    if (resource.path) void openAppPath(resource.path).catch(() => { setDetail(resource); setError(true); });
    else { setDetail(resource); setError(false); }
  };
  const rows = (resources: TaskContextResource[]) => resources.map(resource => <ResourceRow key={resource.id} resource={resource} select={select} />);
  return <div className="right-rail-context" aria-label={t('control.rightRail.context.resources')}>
    {rows(task.resources.slice(0, 5))}
    {task.resources.length > 5 && <Button variant="ghost" size="sm" className="right-rail-browse-all"
      onClick={() => { setVisible(50); setAll(true); }}>{t('control.rightRail.browse.all', { count: task.resources.length })}</Button>}
    <TaskDialog open={all} title={t('control.rightRail.context.title')} closeLabel={t('control.rightRail.browse.close')}
      onClose={() => setAll(false)} dataTestId="context-list">
      {rows(task.resources.slice(0, visible))}
      {visible < task.resources.length && <Button variant="ghost" size="sm"
        onClick={() => setVisible(value => value + 50)}>{t('control.rightRail.browse.more')}</Button>}
    </TaskDialog>
    <TaskDialog open={Boolean(detail)} title={detail?.label ?? ''} closeLabel={t('control.rightRail.browse.close')} onClose={() => setDetail(null)}>
      {detail && <div className="right-rail-resource-detail"><code>{detail.id}</code><p>{detail.summary}</p>
        {detail.path && <code>{detail.path}</code>}{detail.url && <code>{detail.url}</code>}
        {error && <p role="alert">{t('control.rightRail.browse.error')}</p>}</div>}
    </TaskDialog>
  </div>;
}
export const RightRailContext: React.FC<{ task: TaskContextPanelViewModel }> = ({ task }) =>
  <ScopedContext key={`${task.projectId}:${task.sessionId}`} task={task} />;
export default RightRailContext;
