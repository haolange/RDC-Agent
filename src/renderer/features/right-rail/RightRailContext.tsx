import React from 'react';
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

const ResourceRow: React.FC<{ resource: TaskContextResource }> = ({ resource }) => {
  const { t } = useI18n();
  const description = resource.summary?.trim();
  const tooltip = [resource.label, description].filter(Boolean).join(' — ');
  return (
    <div className="right-rail-resource-row" title={tooltip || resource.label}>
      <span className="right-rail-resource-mark" data-kind={resource.kind} aria-hidden="true">
        <ResourceMark resource={resource} />
      </span>
      <span className="right-rail-resource-copy">
        <span className="right-rail-resource-label">{resource.label}</span>
        {description ? <span className="right-rail-resource-meta">{description}</span> : null}
      </span>
      {resource.path ? (
        <Button
          variant="ghost"
          size="sm"
          className="right-rail-row-action"
          aria-label={`${t('control.rightRail.outputs.open')} ${resource.label}`}
          onClick={() => void openAppPath(resource.path!)}
        >
          {t('control.rightRail.outputs.open')}
        </Button>
      ) : null}
    </div>
  );
};

export const RightRailContext: React.FC<{ task: TaskContextPanelViewModel }> = ({ task }) => {
  const { t } = useI18n();
  return (
    <div className="right-rail-context" aria-label={t('control.rightRail.context.resources')}>
      <div className="right-rail-resource-list">
        {task.resources.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}
      </div>
    </div>
  );
};

export default RightRailContext;
