import type { ReactNode } from 'react';
import type { ScopedResourceDocument } from '@shared/types/rdcRuntime';
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { formFromContent } from './scopedResourceForm';

export function McpResourceTable({ resources, selectedId, onSelect, onEdit, renderStatus }: {
  resources: ScopedResourceDocument[];
  selectedId: string | null;
  onSelect: (resource: ScopedResourceDocument) => void;
  onEdit: (resource: ScopedResourceDocument) => void;
  renderStatus?: (resource: ScopedResourceDocument) => ReactNode;
}) {
  const { t } = useI18n();
  return (
    <table className="settings-mcp-table">
      <thead><tr>
        <th scope="col">{t('settings.resourceFieldName')}</th>
        <th scope="col">{t('settings.resourceFieldUrl')} / {t('settings.resourceFieldCommand')}</th>
        <th scope="col">{t('settings.mcpStatusTitle')}</th>
        <th scope="col">{t('settings.edit')}</th>
      </tr></thead>
      <tbody>{resources.map((resource) => {
        const form = formFromContent('mcp', resource.id, resource.content);
        const selected = resource.id === selectedId;
        return (
          <tr key={resource.id} className={selected ? 'is-selected' : undefined}>
            <td><Button variant="ghost" size="sm" aria-pressed={selected} onClick={() => onSelect(resource)}>
              {form.name || resource.id}
            </Button></td>
            <td><code>{form.transport === 'streamable-http' ? form.url : form.command}</code></td>
            <td>{renderStatus?.(resource)}</td>
            <td><Button variant="secondary" size="sm" onClick={() => onEdit(resource)}>
              {t('settings.edit')}
            </Button></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
