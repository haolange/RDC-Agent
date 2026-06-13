import React from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { AgentCapabilityPicker, type AgentCapabilityGroup } from './AgentCapabilityPicker';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentManifestEditorProps {
  settings: AppSettings;
  selectedAgent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  onDuplicateAgent: () => void;
  onDeleteAgent: () => void;
  onSaveAgentManifests: () => void | Promise<void>;
  agentRouteSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentRouteSaveMessage: string;
  t: Translate;
}

const BUILTIN_TOOL_OPTIONS = ['read', 'search', 'web'];

const uniqueOptions = (...groups: string[][]): string[] =>
  Array.from(new Set(groups.flat().map((value) => value.trim()).filter(Boolean)))
    .sort((first, second) => first.localeCompare(second));

const buildCapabilityGroups = (
  settings: AppSettings,
  selectedAgent: AgentManifestDraft,
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void,
  t: Translate,
): AgentCapabilityGroup[] => {
  const allAgents = settings.agents.definitions;
  return [
    {
      id: 'tools',
      label: t('settings.tools'),
      values: selectedAgent.tools,
      options: uniqueOptions(BUILTIN_TOOL_OPTIONS, allAgents.flatMap((agent) => agent.tools), selectedAgent.tools),
      onChange: (tools) => onUpdateAgent({ tools }),
    },
    {
      id: 'agents',
      label: t('settings.subAgents'),
      values: selectedAgent.agents,
      options: uniqueOptions(
        allAgents.filter((agent) => agent.id !== selectedAgent.id).map((agent) => agent.id),
        selectedAgent.agents,
      ),
      onChange: (agents) => onUpdateAgent({ agents }),
    },
    {
      id: 'skills',
      label: t('settings.skills'),
      values: selectedAgent.skills,
      options: uniqueOptions(allAgents.flatMap((agent) => agent.skills), selectedAgent.skills),
      onChange: (skills) => onUpdateAgent({ skills }),
    },
    {
      id: 'mcp',
      label: t('settings.mcp'),
      values: selectedAgent.mcpServers,
      options: uniqueOptions(allAgents.flatMap((agent) => agent.mcpServers), selectedAgent.mcpServers),
      onChange: (mcpServers) => onUpdateAgent({ mcpServers }),
    },
  ];
};

export const AgentManifestEditor: React.FC<AgentManifestEditorProps> = ({
  settings,
  selectedAgent,
  onUpdateAgent,
  onDuplicateAgent,
  onDeleteAgent,
  onSaveAgentManifests,
  agentRouteSaveState,
  agentRouteSaveMessage,
  t,
}) => {
  const selectedModel = selectedAgent.models[0] ?? '';
  const selectedCapabilityCount =
    selectedAgent.tools.length + selectedAgent.agents.length + selectedAgent.skills.length + selectedAgent.mcpServers.length;
  const selectedInstructionLength = selectedAgent.instructions.trim().length;
  const capabilityGroups = buildCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const selectedAgentSummary = [
    selectedAgent.enabled ? t('settings.enabled') : t('settings.disabled'),
    selectedAgent.userInvocable ? t('settings.userInvocable') : t('settings.subAgent'),
  ].join(' · ');

  return (
    <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
      <div className="settings-manifest-editor-head">
        <div>
          <div className="settings-field-label">{selectedAgent.name}</div>
          <div className="settings-help-text">{selectedAgentSummary}</div>
        </div>
        <div className="settings-manifest-editor-actions">
          <button type="button" className="button button-secondary" onClick={onDuplicateAgent}>
            {t('settings.duplicateAgent')}
          </button>
          <button type="button" className="button button-secondary" onClick={onDeleteAgent}>
            {t('settings.deleteAgent')}
          </button>
        </div>
      </div>

      <div className="settings-agent-overview-strip" aria-label={t('settings.configurationSummary')}>
        <div className="settings-agent-overview-item">
          <span>{t('settings.agentStatus')}</span>
          <strong>{selectedAgent.enabled ? t('settings.enabled') : t('settings.disabled')}</strong>
        </div>
        <div className="settings-agent-overview-item">
          <span>{t('settings.agentModel')}</span>
          <strong>{selectedModel || t('settings.noModelSelected')}</strong>
        </div>
        <div className="settings-agent-overview-item">
          <span>{t('settings.agentCapabilityScope')}</span>
          <strong>{t('settings.capabilityCount', { count: selectedCapabilityCount })}</strong>
        </div>
        <div className="settings-agent-overview-item">
          <span>{t('settings.agentInstructionScope')}</span>
          <strong>{selectedInstructionLength > 0 ? t('settings.configured') : t('settings.unset')}</strong>
        </div>
      </div>

      <section className="settings-agent-route-panel">
        <div className="settings-section-header">
          <div>
            <div className="settings-section-title">{t('settings.agentPrimaryRoute')}</div>
            <div className="settings-section-subtitle">{t('settings.agentPrimaryRouteHint')}</div>
          </div>
        </div>
        <div className="settings-manifest-form-grid">
          <div className="settings-input-row">
            <span className="settings-help-text">{t('settings.modelFieldLabel')}</span>
            <AgentModelCascadeSelect
              value={selectedModel}
              options={settings.agents.modelOptions}
              onChange={(model) => onUpdateAgent({ models: [model] })}
              t={t}
            />
          </div>
          <div className="settings-agent-flags">
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={selectedAgent.enabled} onChange={(event) => onUpdateAgent({ enabled: event.currentTarget.checked })} />
              <span>{t('settings.agentEnabled')}</span>
            </label>
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={selectedAgent.userInvocable} onChange={(event) => onUpdateAgent({ userInvocable: event.currentTarget.checked })} />
              <span>{t('settings.userInvocable')}</span>
            </label>
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={selectedAgent.disableModelInvocation} onChange={(event) => onUpdateAgent({ disableModelInvocation: event.currentTarget.checked })} />
              <span>{t('settings.disableModelInvocation')}</span>
            </label>
          </div>
        </div>
      </section>

      <details className="settings-advanced-panel">
        <summary>
          <span>{t('settings.agentAdvancedIdentity')}</span>
          <small>{t('settings.agentAdvancedIdentityHint')}</small>
        </summary>
        <div className="settings-advanced-content">
          <div className="settings-manifest-form-grid settings-agent-identity-grid">
            <label className="settings-input-row">
              <span className="settings-help-text">{t('settings.agentName')}</span>
              <input className="input" value={selectedAgent.name} onChange={(event) => onUpdateAgent({ name: event.currentTarget.value })} />
            </label>
            <label className="settings-input-row">
              <span className="settings-help-text">{t('settings.agentArgumentHint')}</span>
              <AutosizeTextarea rows={1} maxHeight={132} className="input settings-agent-textarea-compact" value={selectedAgent.argumentHint} onChange={(event) => onUpdateAgent({ argumentHint: event.currentTarget.value })} />
            </label>
            <label className="settings-input-row">
              <span className="settings-help-text">{t('settings.agentDescription')}</span>
              <AutosizeTextarea rows={1} maxHeight={132} className="input settings-agent-textarea-compact settings-agent-description-field" value={selectedAgent.description} onChange={(event) => onUpdateAgent({ description: event.currentTarget.value })} />
            </label>
          </div>
        </div>
      </details>

      <details className="settings-advanced-panel">
        <summary>
          <span>{t('settings.agentAdvancedCapabilities')}</span>
          <small>{t('settings.agentAdvancedCapabilitiesHint')}</small>
        </summary>
        <div className="settings-advanced-content">
          <AgentCapabilityPicker groups={capabilityGroups} t={t} />
        </div>
      </details>

      <details className="settings-advanced-panel">
        <summary>
          <span>{t('settings.agentAdvancedInstructions')}</span>
          <small>{t('settings.agentAdvancedInstructionsHint')}</small>
        </summary>
        <div className="settings-advanced-content">
          <label className="settings-input-row">
            <span className="settings-help-text">{t('settings.agentInstructions')}</span>
            <AutosizeTextarea maxHeight={520} className="input settings-agent-instructions settings-agent-handoff-textarea" value={selectedAgent.instructions} onChange={(event) => onUpdateAgent({ instructions: event.currentTarget.value })} />
          </label>
        </div>
      </details>

      <div className="settings-actions settings-manifest-editor-savebar">
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
  );
};
