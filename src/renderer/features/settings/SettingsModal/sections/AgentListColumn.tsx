import { Button } from '../../../../ui/Button';
import { SplitButton } from '../../../../ui/SplitButton';
import { EmptyState } from '../../../../ui/EmptyState';
import { Icon } from '../../../../ui/Icon';
import { Chevron } from '../../../../ui/Chevron';
import { useI18n } from '../../../../i18n';
import { AgentListItem } from './AgentListItem';
import type { Ref } from 'react';
import type { AgentScope } from './agentDraftFactory';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

/** The scope's Agents with their count and the create action, then the manifest problems when there are any. */
export function AgentListColumn({
  listRef,
  scope,
  drafts,
  selectedId,
  describe,
  canCreate,
  diagnosticsCount,
  diagnosticsOpen,
  onSelect,
  onCreate,
  onImport,
  onOpenDiagnostics,
}: {
  listRef: Ref<HTMLDivElement>;
  scope: AgentScope;
  drafts: AgentManifestDraft[];
  selectedId: string;
  describe: (agent: AgentManifestDraft) => string;
  canCreate: boolean;
  diagnosticsCount: number;
  diagnosticsOpen: boolean;
  onSelect: (agentId: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onOpenDiagnostics: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-manifest-list-column">
      <div className="settings-manifest-list-toolbar">
        <span className="settings-manifest-count">{t('settings.agentListCount', { count: drafts.length })}</span>
        <SplitButton
          dataTestId="settings-agent-create"
          label={t('settings.newAgent')}
          onClick={onCreate}
          disabled={!canCreate}
          menuLabel={t('settings.newAgentMore')}
          items={[{ id: 'import', label: t('settings.importAgentManifest'), onSelect: onImport }]}
        />
      </div>

      <div ref={listRef} className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
        {drafts.length === 0 ? (
          <EmptyState
            className="settings-manifest-list-empty"
            title={t('settings.agentScopeEmpty', {
              scope: scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser'),
            })}
          />
        ) : (
          drafts.map((agent) => (
            <AgentListItem
              key={agent.id}
              id={agent.id}
              name={agent.name}
              description={describe(agent)}
              icon={agent.icon}
              selected={agent.id === selectedId}
              onSelect={() => onSelect(agent.id)}
            />
          ))
        )}
      </div>

      {diagnosticsCount > 0 ? (
        <div
          className="settings-agent-tool-diagnostics settings-agent-diagnostics-row"
          data-testid="settings-agent-manifest-diagnostics"
        >
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            className="settings-agent-diagnostics-toggle"
            aria-expanded={diagnosticsOpen}
            onClick={onOpenDiagnostics}
          >
            <Icon name="warning" size={14} className="settings-agent-diagnostics-icon" />
            <span>{t('settings.agentDiagnosticsCount', { count: diagnosticsCount })}</span>
            <span className="settings-agent-diagnostics-link">{t('settings.agentDiagnosticsView')}</span>
            <Chevron />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
