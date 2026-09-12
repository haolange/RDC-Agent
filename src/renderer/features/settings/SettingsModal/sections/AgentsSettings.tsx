import React, { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { EmptyState } from '../../../../ui/EmptyState';
import { Icon } from '../../../../ui/Icon';
import { ListRow } from '../../../../ui/ListRow';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { SettingsScopeBar } from '../parts';
import { AgentAutosaveStatus } from './AgentAutosaveStatus';
import { AgentManifestEditor, type AgentProvenanceScope } from './AgentManifestEditor';
import { uniqueResourceId } from './uniqueResourceId';

type Translate = ReturnType<typeof useI18n>['t'];
type AgentScope = 'user' | 'project';

const AGENT_DESCRIPTION_KEYS: Partial<Record<string, TranslationKey>> = {
  analyzer: 'settings.agentDescription.analyzer',
  general: 'settings.agentDescription.general',
  debugger: 'settings.agentDescription.debugger',
  optimizer: 'settings.agentDescription.optimizer',
};

interface AgentsSettingsProps {
  settings: AppSettings;
  agentManifestDrafts: AgentManifestDraft[];
  onAgentManifestDraftsChange: Dispatch<SetStateAction<AgentManifestDraft[]>>;
  onRetrySaveAgentManifests: () => void | Promise<unknown>;
  onImportAgentManifest: () => void | Promise<void>;
  agentManifestSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentManifestSaveMessage: string;
  agentManifestSaveBlocked?: boolean;
  /** Whether a project is open; the Project tab is disabled without one. */
  canProject: boolean;
  t: Translate;
}

const visibleDrafts = (drafts: AgentManifestDraft[]): AgentManifestDraft[] =>
  drafts.filter((draft) => !draft.delete);

const toSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';

const getAgentCardDescription = (agent: AgentManifestDraft, t: Translate): string => {
  const key = AGENT_DESCRIPTION_KEYS[agent.id];
  return key ? t(key) : agent.description;
};

/** Read-only scope filter: `writeScope` mirrors the definition provenance (builtin drafts write to user). */
const draftScope = (draft: AgentManifestDraft): AgentScope => (draft.writeScope === 'project' ? 'project' : 'user');

const createNewAgent = (existing: AgentManifestDraft[], t: Translate): AgentManifestDraft => {
  const base = 'custom-agent';
  let index = 1;
  let id = base;
  const ids = new Set(existing.map((entry) => entry.id));
  while (ids.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }
  return {
    id,
    fileName: `${id}.agent.md`,
    name: t('settings.agentDefaultName'),
    description: t('settings.agentDefaultDescription'),
    argumentHint: t('settings.agentDefaultArgumentHint'),
    target: 'rdc-agent',
    models: [],
    icon: 'spark',
    accent: '#33d1ff',
    disableModelInvocation: false,
    userInvocable: false,
    tools: [],
    skills: [],
    mcpServers: [],
    agents: [],
    handoffs: [],
    metadata: {},
    instructions: t('settings.agentDefaultInstructions'),
    enabled: true,
  };
};

export const AgentsSettings: React.FC<AgentsSettingsProps> = ({
  settings,
  agentManifestDrafts,
  onAgentManifestDraftsChange,
  onRetrySaveAgentManifests,
  onImportAgentManifest,
  agentManifestSaveState,
  agentManifestSaveMessage,
  agentManifestSaveBlocked = false,
  canProject,
  t,
}) => {
  const [scope, setScope] = useState<AgentScope>('user');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const activeDrafts = visibleDrafts(agentManifestDrafts);
  const scopedDrafts = useMemo(() => activeDrafts.filter((draft) => draftScope(draft) === scope), [activeDrafts, scope]);
  const [selectedAgentId, setSelectedAgentId] = useState(scopedDrafts[0]?.id ?? '');
  const [pendingDelete, setPendingDelete] = useState<AgentManifestDraft | null>(null);
  const selectedAgent = scopedDrafts.find((agent) => agent.id === selectedAgentId) ?? scopedDrafts[0] ?? null;
  const selectedId = selectedAgent?.id ?? '';
  const diagnostics = settings.agents.diagnostics ?? [];
  const provenanceScope: AgentProvenanceScope | null = selectedAgent
    ? settings.agents.definitions.find((definition) => definition.id === selectedAgent.id)?.provenance?.scope ?? null
    : null;

  const updateAgent = (patch: Partial<AgentManifestDraft>) => {
    if (!selectedAgent) return;
    onAgentManifestDraftsChange((current) => current.map((agent) => (
      agent.id === selectedAgent.id ? { ...agent, ...patch } : agent
    )));
  };

  const addAgent = () => {
    onAgentManifestDraftsChange((current) => {
      const next = createNewAgent(current, t);
      setSelectedAgentId(next.id);
      setScope('user');
      return [...current, next];
    });
  };

  const duplicateAgent = () => {
    if (!selectedAgent) return;
    onAgentManifestDraftsChange((current) => {
      const nextId = uniqueResourceId(`${toSlug(selectedAgent.id)}-copy`, current.map((agent) => agent.id));
      const duplicate = {
        ...selectedAgent,
        id: nextId,
        fileName: `${nextId}.agent.md`,
        name: uniqueResourceId(`${selectedAgent.name} Copy`, current.map((agent) => agent.name)),
      };
      setSelectedAgentId(nextId);
      return [...current, duplicate];
    });
  };

  const deleteAgent = () => {
    if (selectedAgent) setPendingDelete(selectedAgent);
  };

  const confirmDeleteAgent = () => {
    const target = pendingDelete;
    if (!target) return;
    onAgentManifestDraftsChange((current) => current.map((agent) => (
      agent.id === target.id ? { ...agent, delete: true, enabled: false } : agent
    )));
    const next = scopedDrafts.find((agent) => agent.id !== target.id);
    setSelectedAgentId(next?.id ?? '');
    setPendingDelete(null);
  };

  return (
    <div className="settings-manifest-page">
      <div className="settings-manifest-toolbar settings-manifest-page-toolbar" data-testid="settings-agents-toolbar">
        <SettingsScopeBar
          scope={scope}
          onScopeChange={setScope}
          canProject={canProject}
          userLabel={t('settings.scopeUser')}
          projectLabel={t('settings.scopeProject')}
          groupLabel={t('settings.resourceScope')}
        />
        <AgentAutosaveStatus
          state={agentManifestSaveState}
          message={agentManifestSaveMessage}
          blocked={agentManifestSaveBlocked}
          onRetry={onRetrySaveAgentManifests}
          t={t}
        />
      </div>

      <div className="settings-manifest-layout">
        <div className="settings-manifest-list-column">
          <div className="settings-manifest-toolbar settings-manifest-list-toolbar">
            <span className="settings-manifest-count">
              {t('settings.agentListCount', { count: scopedDrafts.length })}
            </span>
            <div className="settings-manifest-actions">
              <Button variant="secondary" size="sm" onClick={() => void onImportAgentManifest()}>
                {t('settings.importAgentManifest')}
              </Button>
              <Button variant="primary" size="sm" onClick={addAgent}>
                {t('settings.newAgent')}
              </Button>
            </div>
          </div>

          <div className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
            {scopedDrafts.length === 0 ? (
              <EmptyState
                className="settings-manifest-list-empty"
                title={t('settings.agentScopeEmpty', { scope: scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser') })}
              />
            ) : scopedDrafts.map((agent) => (
              <ListRow
                key={agent.id}
                className="settings-manifest-row"
                selected={agent.id === selectedId}
                leading={(
                  <span className="settings-manifest-card-icon" aria-hidden="true">
                    <ModeGlyph mode={agent.id} icon={agent.icon ?? 'message-orbit'} size={17} strokeWidth={1.9} />
                  </span>
                )}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <span className="settings-manifest-row-copy">
                  <strong>{agent.name}</strong>
                  <small>{getAgentCardDescription(agent, t)}</small>
                </span>
              </ListRow>
            ))}
          </div>

          {diagnostics.length > 0 ? (
            <div className="settings-agent-tool-diagnostics settings-agent-diagnostics-row" data-testid="settings-agent-manifest-diagnostics">
              <button
                type="button"
                className="settings-agent-diagnostics-toggle"
                aria-expanded={diagnosticsOpen}
                onClick={() => setDiagnosticsOpen((current) => !current)}
              >
                <Icon name="warning" size={14} className="settings-agent-diagnostics-icon" />
                <span>{t('settings.agentDiagnosticsCount', { count: diagnostics.length })}</span>
                <span className="settings-agent-diagnostics-link">{diagnosticsOpen ? t('settings.collapse') : t('settings.view')}</span>
                <Icon name={diagnosticsOpen ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
              {diagnosticsOpen ? (
                <ul className="settings-agent-tool-diagnostics-list">
                  {diagnostics.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {selectedAgent ? (
          <AgentManifestEditor
            settings={settings}
            selectedAgent={selectedAgent}
            provenanceScope={provenanceScope}
            onUpdateAgent={updateAgent}
            onDuplicateAgent={duplicateAgent}
            onDeleteAgent={deleteAgent}
            onRetrySaveAgentManifests={onRetrySaveAgentManifests}
            agentManifestSaveState={agentManifestSaveState}
            agentManifestSaveMessage={agentManifestSaveMessage}
            agentManifestSaveBlocked={agentManifestSaveBlocked}
            t={t}
          />
        ) : (
          <div className="settings-runtime-editor-placeholder">
            <EmptyState title={t('settings.agentSelectOrCreate')} />
          </div>
        )}
      </div>
      {pendingDelete ? (
        <ConfirmationDialog
          title={t('settings.deleteAgentTitle')}
          message={t('settings.deleteAgentConfirm', { name: pendingDelete.name || pendingDelete.id })}
          details={[
            { label: t('settings.agentName'), value: pendingDelete.name || pendingDelete.id },
            { label: t('settings.resourceFieldId'), value: pendingDelete.id },
          ]}
          confirmLabel={t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDeleteAgent}
        />
      ) : null}
    </div>
  );
};
