import { cn } from '../../../../lib/cn';
import { useI18n } from '../../../../i18n';
import { Switch } from '../../../../ui/Switch';
import { PlainButton } from '../../../../ui/PlainButton';
import { formFromContent } from './scopedResourceForm';
import type { ScopedResourceDocument } from '@shared/types/rdcRuntime';
import type { ReactNode } from 'react';

/** MCP servers as rows of name · status · switch; how a server is reached lives in its 诊断. */
export function McpResourceList({
  resources,
  selectedId,
  busyId,
  onSelect,
  onToggle,
  renderStatus,
}: {
  resources: ScopedResourceDocument[];
  selectedId: string | null;
  /** The server whose switch is being saved. */
  busyId: string | null;
  onSelect: (resource: ScopedResourceDocument) => void;
  onToggle: (resource: ScopedResourceDocument, enabled: boolean) => void;
  renderStatus: (resource: ScopedResourceDocument) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <ul className="settings-mcp-list" data-testid="settings-mcp-list">
      {resources.map((resource) => {
        const form = formFromContent('mcp', resource.id, resource.content);
        const name = form.name || resource.id;
        const selected = resource.id === selectedId;
        return (
          <li key={`${resource.scope}:${resource.id}`} className={cn('settings-mcp-row', selected && 'is-selected')}>
            <PlainButton className="settings-mcp-row-main" aria-pressed={selected} onClick={() => onSelect(resource)}>
              <span className="settings-mcp-row-name">{name}</span>
              {renderStatus(resource)}
            </PlainButton>
            <Switch
              checked={form.enabled}
              disabled={busyId === resource.id}
              onCheckedChange={(enabled) => onToggle(resource, enabled)}
              aria-label={t('settings.mcpEnabledFor', { name })}
              data-testid="settings-mcp-row-switch"
            />
          </li>
        );
      })}
    </ul>
  );
}
