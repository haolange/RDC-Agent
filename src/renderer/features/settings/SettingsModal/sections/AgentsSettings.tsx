import React, { type Dispatch, type SetStateAction, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { ListRow } from '../../../../ui/ListRow';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { AgentManifestEditor } from './AgentManifestEditor';
import { uniqueResourceId } from './uniqueResourceId';

type Translate = ReturnType<typeof useI18n>['t'];

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
  t,
}) => {
  const activeDrafts = visibleDrafts(agentManifestDrafts);
  const [selectedAgentId, setSelectedAgentId] = useState(activeDrafts[0]?.id ?? '');
  const [pendingDelete, setPendingDelete] = useState<AgentManifestDraft | null>(null);
  const selectedAgent = activeDrafts.find((agent) => agent.id === selectedAgentId) ?? activeDrafts[0] ?? null;
  const selectedId = selectedAgent?.id ?? '';

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
    const next = activeDrafts.find((agent) => agent.id !== target.id);
    setSelectedAgentId(next?.id ?? '');
    setPendingDelete(null);
  };

  return (
    <div className="settings-manifest-page">
        <div className="settings-manifest-layout">
          <div className="settings-manifest-list-column">
            <div className="settings-manifest-toolbar settings-manifest-list-toolbar">
              <div className="settings-manifest-actions">
                <Button variant="secondary" onClick={() => void onImportAgentManifest()}>
                  {t('settings.importAgentManifest')}
                </Button>
                <Button variant="secondary" onClick={addAgent}>
                  {t('settings.newAgent')}
                </Button>
              </div>
            </div>

            {(settings.agents.diagnostics ?? []).length > 0 ? (
              <div
                className="settings-agent-tool-diagnostics"
                data-testid="settings-agent-manifest-diagnostics"
              >
                <ul className="settings-agent-tool-diagnostics-list">
                  {(settings.agents.diagnostics ?? []).map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
              {activeDrafts.map((agent) => (
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
          </div>

          {selectedAgent && (
            <AgentManifestEditor
              settings={settings}
              selectedAgent={selectedAgent}
              onUpdateAgent={updateAgent}
              onDuplicateAgent={duplicateAgent}
              onDeleteAgent={deleteAgent}
              onRetrySaveAgentManifests={onRetrySaveAgentManifests}
              agentManifestSaveState={agentManifestSaveState}
              agentManifestSaveMessage={agentManifestSaveMessage}
              agentManifestSaveBlocked={agentManifestSaveBlocked}
              t={t}
            />
          )}
        </div>
        {pendingDelete ? (
          <ConfirmationDialog
            title={t('settings.deleteAgentTitle')}
            message={t('settings.deleteAgentConfirm', { name: pendingDelete.name || pendingDelete.id })}
            confirmLabel={t('dialog.delete')}
            cancelLabel={t('dialog.cancel')}
            onCancel={() => setPendingDelete(null)}
            onConfirm={confirmDeleteAgent}
          />
        ) : null}
    </div>
  );
};
