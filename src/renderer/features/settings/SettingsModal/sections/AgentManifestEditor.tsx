import React from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { AgentCapabilityPicker, type AgentCapabilityGroup } from './AgentCapabilityPicker';
import { AgentIconPresetPicker } from './AgentIconPresetPicker';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentManifestEditorProps {
  settings: AppSettings;
  selectedAgent: AgentManifestDraft;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  onDuplicateAgent: () => void;
  onDeleteAgent: () => void;
  onRetrySaveAgentManifests: () => void | Promise<unknown>;
  agentManifestSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentManifestSaveMessage: string;
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
  onRetrySaveAgentManifests,
  agentManifestSaveState,
  agentManifestSaveMessage,
  t,
}) => {
  const selectedModel = selectedAgent.models[0] ?? '';
  const capabilityGroups = buildCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const saveStatusMessage = agentManifestSaveState === 'saving'
    ? t('settings.saving')
    : agentManifestSaveMessage;
  const showSaveStatus = agentManifestSaveState === 'saving' || Boolean(agentManifestSaveMessage);

  return (
    <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
      <div className="settings-manifest-editor-head">
        <div className="settings-agent-editor-title">
          <span className="settings-agent-editor-icon" aria-hidden="true">
            <ModeGlyph mode={selectedAgent.id} icon={selectedAgent.icon ?? 'message-orbit'} size={20} strokeWidth={1.9} />
          </span>
          <div className="settings-agent-editor-copy">
            <div className="settings-agent-editor-name">{selectedAgent.name}</div>
          </div>
        </div>
        <div className="settings-manifest-editor-actions">
          <AgentIconPresetPicker
            value={selectedAgent.icon ?? 'message-orbit'}
            onChange={(icon) => onUpdateAgent({ icon })}
            t={t}
          />
          <button type="button" className="button button-ghost" onClick={onDuplicateAgent}>
            {t('settings.duplicateAgent')}
          </button>
          <button type="button" className="button button-danger" onClick={onDeleteAgent}>
            {t('settings.deleteAgent')}
          </button>
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <section className="settings-agent-route-panel">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">{t('settings.agentRouteAvailability')}</div>
            </div>
          </div>
          <div className="settings-manifest-form-grid">
            <div className="settings-input-row settings-model-route-row">
              <span className="settings-field-label">{t('settings.modelFieldLabel')}</span>
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
                <span className="settings-field-label">{t('settings.agentName')}</span>
                <input className="input" value={selectedAgent.name} onChange={(event) => onUpdateAgent({ name: event.currentTarget.value })} />
              </label>
              <label className="settings-input-row">
                <span className="settings-field-label">{t('settings.agentArgumentHint')}</span>
                <AutosizeTextarea rows={1} maxHeight={132} className="input settings-agent-textarea-compact" value={selectedAgent.argumentHint} onChange={(event) => onUpdateAgent({ argumentHint: event.currentTarget.value })} />
              </label>
              <label className="settings-input-row">
                <span className="settings-field-label">{t('settings.agentDescription')}</span>
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
          </summary>
          <div className="settings-advanced-content">
            <AutosizeTextarea
              rows={2}
              maxHeight={520}
              aria-label={t('settings.agentInstructions')}
              className="input settings-agent-instructions"
              value={selectedAgent.instructions}
              onChange={(event) => onUpdateAgent({ instructions: event.currentTarget.value })}
            />
          </div>
        </details>
      </div>

      {showSaveStatus ? (
        <div className={`settings-agent-autosave-status ${agentManifestSaveState}`}>
          <span>{saveStatusMessage}</span>
          {agentManifestSaveState === 'error' ? (
            <button type="button" className="button button-secondary" onClick={() => void onRetrySaveAgentManifests()}>
              {t('settings.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
