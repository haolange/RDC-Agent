import React from 'react';
import { diagnoseManifestToolTokens } from '@shared/constants/agentToolTokens';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Button } from '../../../../ui/Button';
import { ColorField } from '../../../../ui/ColorField';
import { Input } from '../../../../ui/Input';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField, SettingsSection } from '../parts';
import { AgentCapabilityPicker, buildAgentCapabilityGroups } from './AgentCapabilityPicker';
import { AgentHandoffEditor } from './AgentHandoffEditor';
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
  agentManifestSaveBlocked?: boolean;
  t: Translate;
}

export const AgentManifestEditor: React.FC<AgentManifestEditorProps> = ({
  settings,
  selectedAgent,
  onUpdateAgent,
  onDuplicateAgent,
  onDeleteAgent,
  onRetrySaveAgentManifests,
  agentManifestSaveState,
  agentManifestSaveMessage,
  agentManifestSaveBlocked = false,
  t,
}) => {
  const selectedModel = selectedAgent.models[0] ?? '';
  const capabilityGroups = buildAgentCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const toolDiagnostics = diagnoseManifestToolTokens(selectedAgent.tools);
  const saveStatusMessage = agentManifestSaveState === 'saving'
    ? t('settings.saving')
    : agentManifestSaveMessage;
  const showSaveStatus = agentManifestSaveState === 'saving' || Boolean(agentManifestSaveMessage);
  const agentAccentStyle = useDynStyle({
    '--settings-agent-accent': selectedAgent.accent || '#33d1ff',
  });

  return (
    <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
      <div className="settings-manifest-editor-head">
        <div className="settings-agent-editor-title">
          <span
            className="settings-agent-editor-icon"
            aria-hidden="true"
            {...agentAccentStyle}
          >
            <ModeGlyph mode={selectedAgent.id} icon={selectedAgent.icon ?? 'message-orbit'} size={20} strokeWidth={1.9} />
          </span>
          <div className="settings-agent-editor-copy">
            <div className="settings-agent-editor-name">{selectedAgent.name}</div>
          </div>
        </div>
        <div className="settings-manifest-editor-actions">
          <Button variant="ghost" onClick={onDuplicateAgent}>
            {t('settings.duplicateAgent')}
          </Button>
          <Button variant="danger" onClick={onDeleteAgent}>
            {t('settings.deleteAgent')}
          </Button>
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <SettingsSection title={t('settings.agentRouteAvailability')} className="settings-agent-route-panel">
          <div className="settings-agent-route-body">
            <div
              className="settings-agent-look-strip"
              data-testid="settings-agent-look"
              {...agentAccentStyle}
            >
              <div className="settings-agent-route-row settings-agent-look-icon-row">
                <span className="settings-field-label settings-agent-look-label">{t('settings.agentIcon')}</span>
                <AgentIconPresetPicker
                  value={selectedAgent.icon ?? 'message-orbit'}
                  onChange={(icon) => onUpdateAgent({ icon })}
                  t={t}
                />
              </div>
              <div className="settings-agent-route-row settings-agent-look-accent-row">
                <ColorField
                  className="settings-agent-accent-color"
                  layout="inline"
                  label={t('settings.agentAccent')}
                  areaLabel={t('settings.colorPickerArea')}
                  hueLabel={t('settings.colorPickerHue')}
                  value={selectedAgent.accent ?? '#33d1ff'}
                  testId="settings-agent-accent"
                  onChange={(accent) => onUpdateAgent({ accent })}
                />
              </div>
              <p className="settings-agent-look-hint">{t('settings.agentAccentHelp')}</p>
            </div>

            <SettingsField
              className="settings-agent-route-row settings-model-route-row"
              layout="row"
              label={t('settings.modelFieldLabel')}
            >
              <AgentModelCascadeSelect
                value={selectedModel}
                options={settings.agents.modelOptions}
                onChange={(model) => onUpdateAgent({ models: [model] })}
                t={t}
              />
            </SettingsField>

            <SettingsField
              className="settings-agent-route-row settings-agent-availability-row"
              layout="row"
              label={t('settings.agentAvailability')}
            >
              <div className="settings-agent-flags">
                <label className="settings-checkbox-row compact">
                  <input type="checkbox" checked={selectedAgent.enabled} onChange={(event) => onUpdateAgent({ enabled: event.currentTarget.checked })} />
                  <span>{t('settings.agentEnabled')}</span>
                </label>
                <label className="settings-checkbox-row compact">
                  <input type="checkbox" checked={selectedAgent.userInvocable} onChange={(event) => onUpdateAgent({ userInvocable: event.currentTarget.checked })} />
                  <span>{t('settings.userInvocable')}</span>
                </label>
                <label className="settings-checkbox-row compact">
                  <input type="checkbox" checked={selectedAgent.disableModelInvocation} onChange={(event) => onUpdateAgent({ disableModelInvocation: event.currentTarget.checked })} />
                  <span>{t('settings.disableModelInvocation')}</span>
                </label>
              </div>
            </SettingsField>
          </div>
        </SettingsSection>

        <details className="settings-advanced-panel">
          <summary>
            <span>{t('settings.agentAdvancedIdentity')}</span>
            <small>{t('settings.agentAdvancedIdentityHint')}</small>
          </summary>
          <div className="settings-advanced-content">
            <div className="settings-manifest-form-grid settings-agent-identity-grid">
              <SettingsField className="settings-input-row" label={t('settings.agentName')}>
                <Input value={selectedAgent.name} onChange={(event) => onUpdateAgent({ name: event.currentTarget.value })} />
              </SettingsField>
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
            {toolDiagnostics.length > 0 ? (
              <div
                className="settings-agent-tool-diagnostics"
                data-testid="settings-agent-tool-diagnostics"
                role="status"
              >
                <div className="settings-agent-tool-diagnostics-title">
                  {t('settings.agentToolDiagnosticsTitle')}
                </div>
                <ul className="settings-agent-tool-diagnostics-list">
                  {toolDiagnostics.map((item) => (
                    <li key={item.token}>
                      <code>{item.token}</code>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>

        <details className="settings-advanced-panel">
          <summary>
            <span>{t('settings.handoffs')}</span>
            <small>{t('settings.agentHandoffsHint')}</small>
          </summary>
          <div className="settings-advanced-content">
            <AgentHandoffEditor
              key={selectedAgent.id}
              selfId={selectedAgent.id}
              handoffs={selectedAgent.handoffs}
              definitions={settings.agents.definitions}
              modelOptions={settings.agents.modelOptions}
              forceShowRequired={agentManifestSaveBlocked}
              onChange={(handoffs) => onUpdateAgent({ handoffs })}
              t={t}
            />
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
          {agentManifestSaveState === 'error' && !agentManifestSaveBlocked ? (
            <Button variant="secondary" onClick={() => void onRetrySaveAgentManifests()}>
              {t('settings.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
