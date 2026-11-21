import React, { useState } from 'react';
import { TaskDialog } from '../../ui/TaskDialog';
import { openAppPath } from '../../hooks/appShellBridge';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/InlineError';
import { Icon, type IconName } from '../../ui/Icon';
import { Chevron } from '../../ui/Chevron';
import type { TaskContextPanelViewModel, TaskContextResource } from '@shared/types/trace';

const RESOURCE_ICONS: Record<TaskContextResource['kind'], IconName> = {
  directory: 'folder',
  mcp: 'plug',
  web: 'web-fetch',
  skill: 'nav-skills',
  attachment: 'attachment',
  reference: 'link',
  file: 'file',
};

const ResourceMark: React.FC<{ resource: TaskContextResource }> = ({ resource }) => <Icon name={RESOURCE_ICONS[resource.kind]} size={14} />;

const ResourceRow: React.FC<{ resource: TaskContextResource; select: (resource: TaskContextResource) => void }> = ({ resource, select }) => {
  const { t } = useI18n();
  const kind = t(`control.rightRail.context.kind.${resource.kind}`);
  return (
    <Button variant="ghost" className="right-rail-compact-row" data-tooltip={`${kind} · ${resource.label}`} onClick={() => select(resource)}>
      <span className="right-rail-compact-icon" aria-hidden="true"><ResourceMark resource={resource} /></span>
      <span className="right-rail-compact-copy">
        <span className="right-rail-compact-title">{resource.label}</span>
        <span className="right-rail-compact-kind">{kind}</span>
      </span>
      <Chevron />
    </Button>
  );
};

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
        {error && <InlineError>{t('control.rightRail.browse.error')}</InlineError>}</div>}
    </TaskDialog>
  </div>;
}
export const RightRailContext: React.FC<{ task: TaskContextPanelViewModel }> = ({ task }) =>
  <ScopedContext key={`${task.projectId}:${task.sessionId}`} task={task} />;
export default RightRailContext;
