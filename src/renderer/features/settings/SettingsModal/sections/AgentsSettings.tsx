import React, { type Dispatch, type SetStateAction, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AgentPermissionMode, AppSettings } from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { AgentManifestEditor } from './AgentManifestEditor';

type Translate = ReturnType<typeof useI18n>['t'];

const AGENT_DESCRIPTION_KEYS: Partial<Record<string, TranslationKey>> = {
  analyzer: 'settings.agentDescription.analyzer',
  ask: 'settings.agentDescription.ask',
  debugger: 'settings.agentDescription.debugger',
  optimizer: 'settings.agentDescription.optimizer',
};

interface AgentsSettingsProps {
  settings: AppSettings;
  permissionModeDraft: AgentPermissionMode;
  readableRootsDraft: string;
  writableRootsDraft: string;
  onPermissionModeDraftChange: (mode: AgentPermissionMode) => void;
  onReadableRootsDraftChange: (value: string) => void;
  onWritableRootsDraftChange: (value: string) => void;
  onSaveAgentPermissions: () => void | Promise<void>;
  agentManifestDrafts: AgentManifestDraft[];
  onAgentManifestDraftsChange: Dispatch<SetStateAction<AgentManifestDraft[]>>;
  onSaveAgentManifests: () => void | Promise<void>;
  onImportAgentManifest: () => void | Promise<void>;
  agentRouteSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentRouteSaveMessage: string;
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

const createNewAgent = (existing: AgentManifestDraft[]): AgentManifestDraft => {
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
    name: 'Custom Agent',
    description: 'Describe what this Agent is responsible for.',
    argumentHint: 'Describe the task for this Agent',
    target: 'rdc-agent',
    models: [],
    icon: 'spark',
    disableModelInvocation: false,
    userInvocable: false,
    tools: [],
    skills: [],
    mcpServers: [],
    agents: [],
    handoffs: [],
    metadata: {},
    instructions: 'You are a focused RDC-Agent specialist. Follow the current project context and report evidence clearly.',
    enabled: true,
  };
};

export const AgentsSettings: React.FC<AgentsSettingsProps> = ({
  settings,
  permissionModeDraft,
  readableRootsDraft,
  writableRootsDraft,
  onPermissionModeDraftChange,
  onReadableRootsDraftChange,
  onWritableRootsDraftChange,
  onSaveAgentPermissions,
  agentManifestDrafts,
  onAgentManifestDraftsChange,
  onSaveAgentManifests,
  onImportAgentManifest,
  agentRouteSaveState,
  agentRouteSaveMessage,
  t,
}) => {
  const activeDrafts = visibleDrafts(agentManifestDrafts);
  const [selectedAgentId, setSelectedAgentId] = useState(activeDrafts[0]?.id ?? '');
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
      const next = createNewAgent(current);
      setSelectedAgentId(next.id);
      return [...current, next];
    });
  };

  const duplicateAgent = () => {
    if (!selectedAgent) return;
    onAgentManifestDraftsChange((current) => {
      const nextId = `${toSlug(selectedAgent.id)}-copy`;
      const duplicate = {
        ...selectedAgent,
        id: nextId,
        fileName: `${nextId}.agent.md`,
        name: `${selectedAgent.name} Copy`,
      };
      setSelectedAgentId(nextId);
      return [...current, duplicate];
    });
  };

  const deleteAgent = () => {
    if (!selectedAgent) return;
    onAgentManifestDraftsChange((current) => current.map((agent) => (
      agent.id === selectedAgent.id ? { ...agent, delete: true, enabled: false } : agent
    )));
    const next = activeDrafts.find((agent) => agent.id !== selectedAgent.id);
    setSelectedAgentId(next?.id ?? '');
  };

  return (
    <section className="settings-page settings-page-agents">
      <div className="settings-manifest-page">
        <div className="settings-manifest-layout">
          <div className="settings-manifest-list-column">
            <div className="settings-manifest-toolbar settings-manifest-list-toolbar">
              <div className="settings-manifest-actions">
                <button type="button" className="button button-secondary" onClick={() => void onImportAgentManifest()}>
                  {t('settings.importAgentManifest')}
                </button>
                <button type="button" className="button button-secondary" onClick={addAgent}>
                  {t('settings.newAgent')}
                </button>
              </div>
            </div>

            <div className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
              {activeDrafts.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`settings-manifest-card ${agent.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <span className="settings-manifest-card-icon" aria-hidden="true">
                    <ModeGlyph mode={agent.id} icon={agent.icon ?? 'message-orbit'} size={17} strokeWidth={1.9} />
                  </span>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{getAgentCardDescription(agent, t)}</small>
                  </span>
                </button>
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
              onSaveAgentManifests={onSaveAgentManifests}
              permissionModeDraft={permissionModeDraft}
              readableRootsDraft={readableRootsDraft}
              writableRootsDraft={writableRootsDraft}
              onPermissionModeDraftChange={onPermissionModeDraftChange}
              onReadableRootsDraftChange={onReadableRootsDraftChange}
              onWritableRootsDraftChange={onWritableRootsDraftChange}
              onSaveAgentPermissions={onSaveAgentPermissions}
              agentRouteSaveState={agentRouteSaveState}
              agentRouteSaveMessage={agentRouteSaveMessage}
              t={t}
            />
          )}
        </div>
      </div>
    </section>
  );
};
