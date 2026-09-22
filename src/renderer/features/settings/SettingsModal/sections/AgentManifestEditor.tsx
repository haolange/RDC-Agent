import React, { useState } from 'react';
import { diagnoseManifestToolTokens } from '@shared/constants/agentToolTokens';
import type { AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon, type IconName } from '../../../../ui/Icon';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import type { AgentSkillCatalog } from './AgentSkillPicker';
import { SettingsField, SettingsSection } from '../parts';
import { AgentIdentityPanel } from './AgentIdentityPanel';
import { AgentCapabilityPicker, buildAgentCapabilityGroups } from './AgentCapabilityPicker';
import { AgentHandoffEditor } from './AgentHandoffEditor';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';
import { AgentAutosaveStatus } from './AgentAutosaveStatus';

type Translate = ReturnType<typeof useI18n>['t'];
type AgentPanel = 'identity' | 'permissions' | 'handoffs' | 'instructions';
export type AgentProvenanceScope = AgentManifestDefinition['provenance'] extends infer P
  ? P extends { scope: infer S } ? S : never
  : never;

interface AgentManifestEditorProps {
  skills: AgentSkillCatalog;
  settings: AppSettings;
  selectedAgent: AgentManifestDraft;
  /** Read-only origin of the definition (builtin / user / project); new drafts have none yet. */
  provenanceScope: AgentProvenanceScope | null;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  onDuplicateAgent: () => void;
  onDeleteAgent: () => void;
  onRetrySaveAgentManifests: () => void | Promise<unknown>;
  agentManifestSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentManifestSaveMessage: string;
  agentManifestSaveBlocked?: boolean;
  t: Translate;
}

const PANELS: Array<{ id: AgentPanel; icon: IconName }> = [
  { id: 'identity', icon: 'user' },
  { id: 'permissions', icon: 'lock' },
  { id: 'handoffs', icon: 'link' },
  { id: 'instructions', icon: 'nav-skills' },
];

/** Read-only configuration status derived from the enabled flag and the projected model option. */
function configStatus(agent: AgentManifestDraft, settings: AppSettings, t: Translate): { label: string; tone: 'success' | 'warning' | 'error' | 'primary' } {
  if (!agent.enabled) return { label: t('settings.disabled'), tone: 'primary' };
  const modelId = agent.models[0] ?? '';
  if (!modelId) return { label: t('settings.agentStatusNoModel'), tone: 'warning' };
  const option = settings.agents.modelOptions.find((entry) => entry.canonicalId === modelId);
  if (!option) return { label: t('settings.routeReasonModelInvalid'), tone: 'error' };
  if (option.status === 'ready') return { label: t('settings.agentStatusAvailable'), tone: 'success' };
  return { label: option.disabledReason ?? t('settings.modelUnavailable'), tone: 'warning' };
}

export function provenanceLabel(scope: AgentProvenanceScope | null, t: Translate): string {
  if (scope === 'project') return t('settings.scopeProject');
  if (scope === 'user') return t('settings.scopeUser');
  if (scope === 'builtin') return t('settings.scopeBuiltin');
  return t('settings.unsaved');
}

export const AgentManifestEditor: React.FC<AgentManifestEditorProps> = ({
  skills,
  settings,
  selectedAgent,
  provenanceScope,
  onUpdateAgent,
  onDuplicateAgent,
  onDeleteAgent,
  onRetrySaveAgentManifests,
  agentManifestSaveState,
  agentManifestSaveMessage,
  agentManifestSaveBlocked = false,
  t,
}) => {
  const [openPanel, setOpenPanel] = useState<AgentPanel | null>(null);
  const selectedModel = selectedAgent.models[0] ?? '';
  const capabilityGroups = buildAgentCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const toolDiagnostics = diagnoseManifestToolTokens(selectedAgent.tools);
  const status = configStatus(selectedAgent, settings, t);
  const agentAccentStyle = useDynStyle({
    '--settings-agent-accent': selectedAgent.accent || '#33d1ff',
  });
  const autosave = (
    <AgentAutosaveStatus
      state={agentManifestSaveState}
      message={agentManifestSaveMessage}
      blocked={agentManifestSaveBlocked}
      onRetry={onRetrySaveAgentManifests}
      compact
      t={t}
    />
  );

  const panelLabel = (panel: AgentPanel): string => (
    panel === 'identity' ? t('settings.agentAdvancedIdentity')
      : panel === 'permissions' ? t('settings.agentAdvancedCapabilities')
        : panel === 'handoffs' ? t('settings.handoffs')
          : t('settings.agentAdvancedInstructions')
  );
  const panelHint = (panel: AgentPanel): string => (
    panel === 'identity' ? t('settings.agentAdvancedIdentityHint')
      : panel === 'permissions' ? t('settings.agentAdvancedCapabilitiesHint')
        : panel === 'handoffs' ? t('settings.agentHandoffsHint')
          : t('settings.agentInstructionsHint')
  );

  const renderPanelBody = (panel: AgentPanel) => {
    if (panel === 'identity') {
      return <AgentIdentityPanel agent={selectedAgent} onUpdateAgent={onUpdateAgent} t={t} />;
    }
    if (panel === 'permissions') {
      return (
        <>
          <AgentCapabilityPicker groups={capabilityGroups} skills={skills} targetAgentId={selectedAgent.id} t={t} />
          {toolDiagnostics.length > 0 ? (
            <div className="settings-agent-tool-diagnostics" data-testid="settings-agent-tool-diagnostics" role="status">
              <div className="settings-agent-tool-diagnostics-title">{t('settings.agentToolDiagnosticsTitle')}</div>
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
        </>
      );
    }
    if (panel === 'handoffs') {
      return (
        <AgentHandoffEditor
          skills={skills}
          key={selectedAgent.id}
          selfId={selectedAgent.id}
          handoffs={selectedAgent.handoffs}
          definitions={settings.agents.definitions}
          modelOptions={settings.agents.modelOptions}
          forceShowRequired={agentManifestSaveBlocked}
          onChange={(handoffs) => onUpdateAgent({ handoffs })}
          t={t}
        />
      );
    }
    return (
      <>
        <div className="settings-agent-instructions-meta">
          <span className="settings-help-text">
            {t('settings.agentInstructionsSource')}: <strong>{provenanceLabel(provenanceScope, t)}</strong>
          </span>
        </div>
        <Textarea
          sizing="content"
          minRows={2}
          aria-label={t('settings.agentInstructions')}
          className="settings-agent-instructions settings-agent-instructions--editor"
          value={selectedAgent.instructions}
          onChange={(event) => onUpdateAgent({ instructions: event.currentTarget.value })}
        />
      </>
    );
  };

  return (
    <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
      <div className="settings-manifest-editor-head">
        <div className="settings-agent-editor-title">
          <span className="settings-agent-editor-icon" aria-hidden="true" {...agentAccentStyle}>
            <ModeGlyph mode={selectedAgent.id} icon={selectedAgent.icon ?? 'message-orbit'} size={20} strokeWidth={1.9} />
          </span>
          <div className="settings-agent-editor-copy">
            <div className="settings-agent-editor-name">
              {selectedAgent.name}
              <Badge tone="primary" data-testid="settings-agent-provenance">{provenanceLabel(provenanceScope, t)}</Badge>
            </div>
            <code className="settings-agent-editor-id">{selectedAgent.id}</code>
          </div>
        </div>
        <div className="settings-manifest-editor-actions">
          <Button variant="ghost" size="sm" onClick={onDuplicateAgent}>
            {t('settings.duplicateAgent')}
          </Button>
          <Button variant="danger" size="sm" onClick={onDeleteAgent}>
            {t('settings.deleteAgent')}
          </Button>
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <SettingsSection title={t('settings.agentRouteAvailability')} className="settings-agent-route-panel">
          <div className="settings-agent-route-body">
            <div className="settings-agent-route-grid">
              <SettingsField label={t('settings.modelFieldLabel')} className="settings-model-route-row">
                <AgentModelCascadeSelect
                  value={selectedModel}
                  options={settings.agents.modelOptions}
                  onChange={(model) => onUpdateAgent({ models: [model] })}
                  t={t}
                />
              </SettingsField>
              <SettingsField label={t('settings.agentStatus')}>
                <div className="settings-agent-config-status" data-testid="settings-agent-config-status" data-tone={status.tone}>
                  <span className="settings-agent-config-status-dot" aria-hidden="true" />
                  {status.label}
                </div>
              </SettingsField>
            </div>

            <div className="settings-agent-flags" role="group" aria-label={t('settings.agentAvailability')}>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.agentEnabled')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.enabled} onCheckedChange={(enabled) => onUpdateAgent({ enabled })} aria-label={t('settings.agentEnabled')} />
                  <span>{selectedAgent.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
                </span>
              </label>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.userInvocable')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.userInvocable} onCheckedChange={(userInvocable) => onUpdateAgent({ userInvocable })} aria-label={t('settings.userInvocable')} />
                  <span>{selectedAgent.userInvocable ? t('settings.enabled') : t('settings.disabled')}</span>
                </span>
              </label>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.disableModelInvocation')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.disableModelInvocation} onCheckedChange={(disableModelInvocation) => onUpdateAgent({ disableModelInvocation })} aria-label={t('settings.disableModelInvocation')} />
                  <span>{selectedAgent.disableModelInvocation ? t('settings.enabled') : t('settings.disabled')}</span>
                </span>
              </label>
            </div>
          </div>
        </SettingsSection>

        <div className="settings-agent-panels" data-testid="settings-agent-panels">
          {PANELS.map(({ id, icon }) => {
            const open = openPanel === id;
            return (
              <section key={id} className={`settings-agent-panel${open ? ' is-open' : ''}`} data-panel={id}>
                <button
                  type="button"
                  className="settings-agent-panel-toggle"
                  aria-expanded={open}
                  aria-controls={`settings-agent-panel-${id}`}
                  data-testid={`settings-agent-panel-${id}`}
                  onClick={(event) => {
                    const section = event.currentTarget.parentElement;
                    setOpenPanel(open ? null : id);
                    if (!open) requestAnimationFrame(() => section?.scrollIntoView({ block: 'nearest' }));
                  }}
                >
                  <Icon name={icon} size={16} className="settings-agent-panel-icon" />
                  <span className="settings-agent-panel-copy">
                    <span className="settings-agent-panel-title">{panelLabel(id)}</span>
                    {!open ? <span className="settings-agent-panel-hint">{panelHint(id)}</span> : null}
                  </span>
                  {open ? autosave : null}
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="settings-agent-panel-caret" />
                </button>
                {open ? (
                  <div id={`settings-agent-panel-${id}`} className="settings-agent-panel-body">
                    {renderPanelBody(id)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
