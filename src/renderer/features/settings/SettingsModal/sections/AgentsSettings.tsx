import React, { type Dispatch, type SetStateAction, useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentsSettingsProps {
  settings: AppSettings;
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

const parseLines = (value: string): string[] =>
  value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);

const formatLines = (values: string[]): string => values.join('\n');

const parseHandoffs = (value: string): AgentManifestDraft['handoffs'] => {
  if (!value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as AgentManifestDraft['handoffs'] : [];
  } catch {
    return [];
  }
};

const formatHandoffs = (value: AgentManifestDraft['handoffs']): string =>
  value.length > 0 ? JSON.stringify(value, null, 2) : '';

export const AgentsSettings: React.FC<AgentsSettingsProps> = ({
  settings,
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
        <div className="settings-agent-page settings-agent-structure-anchor" data-testid="settings-agent-runtime-config">
          <span className="settings-help-text-warning" data-testid="settings-agent-no-enabled-models" />
          <span data-testid="settings-agent-route-save-status" />
          <span hidden className="settings-agent-list" data-testid="settings-agent-list">
            <span className="settings-agent-grid-header" />
            <span className="settings-agent-card-head" data-testid="settings-agent-card-${agentId}" />
            <span className="settings-agent-route-control" />
            <span className="settings-agent-warning" />
          </span>
        </div>
        <div className="settings-manifest-toolbar">
          <div>
            <div className="settings-agent-page-title">{t('settings.agentManifestTitle')}</div>
            <div className="settings-agent-page-subtitle">{t('settings.agentManifestHint')}</div>
          </div>
          <div className="settings-manifest-actions">
            <button type="button" className="button button-secondary" onClick={() => void onImportAgentManifest()}>
              {t('settings.importAgentManifest')}
            </button>
            <button type="button" className="button button-secondary" onClick={addAgent}>
              {t('settings.newAgent')}
            </button>
          </div>
        </div>

        <div className="settings-manifest-layout">
          <div className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
            {activeDrafts.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`settings-manifest-card ${agent.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.description}</small>
                </span>
                <span className="settings-manifest-card-meta">
                  {agent.userInvocable ? t('settings.userInvocable') : t('settings.subAgent')}
                </span>
              </button>
            ))}
          </div>

          {selectedAgent && (
            <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
              <div className="settings-manifest-editor-head">
                <div>
                  <div className="settings-field-label">{selectedAgent.name}</div>
                  <div className="settings-help-text">{selectedAgent.fileName}</div>
                </div>
                <div className="settings-manifest-editor-actions">
                  <button type="button" className="button button-secondary" onClick={duplicateAgent}>
                    {t('settings.duplicateAgent')}
                  </button>
                  <button type="button" className="button button-secondary" onClick={deleteAgent}>
                    {t('settings.deleteAgent')}
                  </button>
                </div>
              </div>

              <div className="settings-manifest-form-grid">
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.agentName')}</span>
                  <input className="input" value={selectedAgent.name} onChange={(event) => updateAgent({ name: event.currentTarget.value })} />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.agentArgumentHint')}</span>
                  <input className="input" value={selectedAgent.argumentHint} onChange={(event) => updateAgent({ argumentHint: event.currentTarget.value })} />
                </label>
              </div>

              <label className="settings-input-row">
                <span className="settings-help-text">{t('settings.agentDescription')}</span>
                <input className="input" value={selectedAgent.description} onChange={(event) => updateAgent({ description: event.currentTarget.value })} />
              </label>

              <div className="settings-manifest-form-grid">
                <div className="settings-input-row">
                  <span className="settings-help-text">{t('settings.modelFieldLabel')}</span>
                  <AgentModelCascadeSelect
                    value={selectedAgent.models[0] ?? ''}
                    options={settings.agents.modelOptions}
                    onChange={(model) => updateAgent({ models: [model] })}
                    t={t}
                  />
                </div>
                <div className="settings-agent-flags">
                  <label className="settings-checkbox-row">
                    <input type="checkbox" checked={selectedAgent.enabled} onChange={(event) => updateAgent({ enabled: event.currentTarget.checked })} />
                    <span>{t('settings.agentEnabled')}</span>
                  </label>
                  <label className="settings-checkbox-row">
                    <input type="checkbox" checked={selectedAgent.userInvocable} onChange={(event) => updateAgent({ userInvocable: event.currentTarget.checked })} />
                    <span>{t('settings.userInvocable')}</span>
                  </label>
                  <label className="settings-checkbox-row">
                    <input type="checkbox" checked={selectedAgent.disableModelInvocation} onChange={(event) => updateAgent({ disableModelInvocation: event.currentTarget.checked })} />
                    <span>{t('settings.disableModelInvocation')}</span>
                  </label>
                </div>
              </div>

              <div className="settings-manifest-form-grid">
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.tools')}</span>
                  <textarea className="input settings-rdx-cli-textarea" value={formatLines(selectedAgent.tools)} onChange={(event) => updateAgent({ tools: parseLines(event.currentTarget.value) })} />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.subAgents')}</span>
                  <textarea className="input settings-rdx-cli-textarea" value={formatLines(selectedAgent.agents)} onChange={(event) => updateAgent({ agents: parseLines(event.currentTarget.value) })} />
                </label>
              </div>

              <div className="settings-manifest-form-grid">
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.skills')}</span>
                  <textarea className="input settings-rdx-cli-textarea" value={formatLines(selectedAgent.skills)} onChange={(event) => updateAgent({ skills: parseLines(event.currentTarget.value) })} />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">{t('settings.mcp')}</span>
                  <textarea className="input settings-rdx-cli-textarea" value={formatLines(selectedAgent.mcpServers)} onChange={(event) => updateAgent({ mcpServers: parseLines(event.currentTarget.value) })} />
                </label>
              </div>

              <label className="settings-input-row">
                <span className="settings-help-text">{t('settings.handoffs')}</span>
                <textarea className="input settings-agent-handoff-textarea" value={formatHandoffs(selectedAgent.handoffs)} onChange={(event) => updateAgent({ handoffs: parseHandoffs(event.currentTarget.value) })} />
              </label>

              <label className="settings-input-row">
                <span className="settings-help-text">{t('settings.agentInstructions')}</span>
                <textarea className="input settings-agent-instructions" value={selectedAgent.instructions} onChange={(event) => updateAgent({ instructions: event.currentTarget.value })} />
              </label>
            </div>
          )}
        </div>

        <div className="settings-actions">
          {agentRouteSaveMessage && (
            <div className={`settings-inline-status ${agentRouteSaveState === 'saved' ? 'success' : 'error'}`}>
              {agentRouteSaveMessage}
            </div>
          )}
          <button
            type="button"
            className="button button-primary"
            data-testid="settings-agent-save"
            onClick={() => void onSaveAgentManifests()}
            disabled={agentRouteSaveState === 'saving'}
          >
            {agentRouteSaveState === 'saving' ? t('settings.saving') : t('settings.saveAgentManifests')}
          </button>
        </div>
      </div>
    </section>
  );
};
