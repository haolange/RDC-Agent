import React from 'react';
import type { TaskContextPanelViewModel, TaskContextResource } from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';

const TOOL_LABELS: Record<string, string> = {
  ask_user: 'Questions', bash: 'Shell', glob: 'Files', grep: 'Search', rdx_context: 'Runtime lookup',
  read_file: 'Files', task_create: 'Tasks', task_get: 'Tasks', task_list: 'Tasks', task_stop: 'Tasks', task_update: 'Tasks',
  web_fetch: 'Web', web_search: 'Web',
};

const displayLabel = (resource: TaskContextResource): string => (
  resource.kind === 'tool' ? TOOL_LABELS[resource.label] ?? resource.label.replaceAll('_', ' ') : resource.label
);

const ResourceMark: React.FC<{ resource: TaskContextResource }> = ({ resource }) => {
  if (resource.kind === 'attachment' || resource.kind === 'reference') {
    return <svg viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" /></svg>;
  }
  if (resource.kind === 'skill' || resource.kind === 'mcp') {
    return <svg viewBox="0 0 16 16"><path d="M8 2.5v11M3.5 5.1 8 2.5l4.5 2.6v5.8L8 13.5l-4.5-2.6z" /></svg>;
  }
  return <svg viewBox="0 0 16 16"><path d="M3 5.5h10M3 10.5h10M5.5 3v10" /></svg>;
};

const distinctResources = (resources: TaskContextResource[]): TaskContextResource[] => {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.kind}:${displayLabel(resource).toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const ResourceRow: React.FC<{ resource: TaskContextResource }> = ({ resource }) => (
  <div className="right-rail-resource-row">
    <span className="right-rail-resource-mark" aria-hidden="true"><ResourceMark resource={resource} /></span>
    <span className="right-rail-resource-label" title={resource.summary ?? resource.label}>{displayLabel(resource)}</span>
    {resource.path ? <Button variant="ghost" size="sm" className="right-rail-row-action" onClick={() => void getElectronApi()?.appShell.openPath(resource.path!)}>Open</Button> : null}
  </div>
);

export const RightRailContext: React.FC<{ task: TaskContextPanelViewModel }> = ({ task }) => {
  const resources = distinctResources(task.resources);
  return (
    <div className="right-rail-context" aria-label="Task context resources">
      <div className="right-rail-resource-list">{resources.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}</div>
    </div>
  );
};

export default RightRailContext;
