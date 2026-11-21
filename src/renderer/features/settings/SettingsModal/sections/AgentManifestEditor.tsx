import React, { useState } from 'react';
import { diagnoseManifestToolTokens } from '@shared/constants/agentToolTokens';
import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Button } from '../../../../ui/Button';
import { Icon, type IconName } from '../../../../ui/Icon';
import { Chevron } from '../../../../ui/Chevron';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsDiagnostics, SettingsSection } from '../parts';
import { InlineError } from '../../../../ui/InlineError';
import { AgentContractFields } from './AgentContractFields';
import { AgentIdentityPanel } from './AgentIdentityPanel';
import { AgentCapabilityPicker, buildAgentCapabilityGroups } from './AgentCapabilityPicker';
import { AgentHandoffEditor } from './AgentHandoffEditor';
import { AgentModelBindingFields } from './AgentModelBindingFields';
import { configStatus, provenanceLabel } from './agentConfigStatus';
import { AgentExecutionLimitField } from './AgentExecutionLimitField';
import type { AgentSkillCatalog } from './AgentSkillPicker';
import type { useI18n } from '../../../../i18n';
import type { AgentModelBinding, AppSettings } from '@shared/types/settings';
import type { AgentManifestDefinition, AgentManifestDraft, AgentManifestProvenance } from '@shared/types/agentManifest';

type Translate = ReturnType<typeof useI18n>['t'];
type AgentPanel = 'identity' | 'permissions' | 'handoffs' | 'instructions';
interface AgentManifestEditorProps {
  skills: AgentSkillCatalog;
  settings: AppSettings;
  selectedAgent: AgentManifestDraft;
  /** Read-only origin of the definition (builtin / user / project, its file and hash); new drafts have none yet. */
  provenance: AgentManifestProvenance | null;
  /** Present when the definition overrides a builtin profile. */
  builtinUpdate: AgentManifestDefinition['builtinUpdate'];
  /** The description in the interface language; a builtin's stored text is translated, an edited one is shown as written. */
  description: string;
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void;
  onModelBindingChange: (binding: AgentModelBinding) => void;
  modelError: string | null;
  onDuplicateAgent: () => void;
  /** Deletes a custom Agent, or removes an override so the builtin applies again. */
  onDeleteAgent: () => void;
  onShowBuiltinDiff: () => void;
  /** A save is blocked until required handoff fields are filled; the handoff editor then shows them. */
  agentManifestSaveBlocked?: boolean;
  t: Translate;
}

const PANELS: Array<{ id: AgentPanel; icon: IconName }> = [
  { id: 'identity', icon: 'user' },
  { id: 'permissions', icon: 'lock' },
  { id: 'handoffs', icon: 'link' },
  { id: 'instructions', icon: 'nav-skills' },
];

export const AgentManifestEditor: React.FC<AgentManifestEditorProps> = ({
  skills,
  settings,
  selectedAgent,
  provenance,
  builtinUpdate,
  description,
  onUpdateAgent,
  onModelBindingChange,
  modelError,
  onDuplicateAgent,
  onDeleteAgent,
  onShowBuiltinDiff,
  agentManifestSaveBlocked = false,
  t,
}) => {
  const [openPanel, setOpenPanel] = useState<AgentPanel | null>(null);
  const provenanceScope = provenance?.scope ?? null;
  const capabilityGroups = buildAgentCapabilityGroups(settings, selectedAgent, onUpdateAgent, t);
  const toolDiagnostics = diagnoseManifestToolTokens(selectedAgent.tools);
  const status = configStatus(selectedAgent, settings, t);
  // A healthy or switched-off Agent says nothing here: the switch already shows it is off.
  const statusProblem = status.tone === 'warning' || status.tone === 'error';
  const agentAccentStyle = useDynStyle({
    '--settings-agent-accent': selectedAgent.accent || '#33d1ff',
  });

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
          <AgentExecutionLimitField agent={selectedAgent} onUpdateAgent={onUpdateAgent} t={t} />
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
          forceShowRequired={agentManifestSaveBlocked}
          onChange={(handoffs) => onUpdateAgent({ handoffs })}
          t={t}
        />
      );
    }
    return (
      <>
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
            <div className="settings-agent-editor-name">{selectedAgent.name}</div>
            {description ? <p className="settings-agent-editor-description">{description}</p> : null}
            {builtinUpdate ? (
              <div className="settings-agent-editor-override" data-testid="settings-agent-override"
                data-tone={builtinUpdate.status === 'updated' ? 'warning' : undefined}>
                {/* The change itself is one click away: the comparison, which can also restore. */}
                <button type="button" className="settings-agent-editor-link" onClick={onShowBuiltinDiff} data-testid="settings-agent-builtin-diff-open"
                  data-tooltip={t('settings.agentBuiltinDiffOpen')}>
                  {t(builtinUpdate.status === 'updated' ? 'settings.agentBuiltinUpdated' : 'settings.agentOverridesBuiltin')}
                </button>
                <button type="button" className="settings-agent-editor-link" onClick={onDeleteAgent} data-testid="settings-agent-restore">
                  {t('settings.agentRestore')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="settings-manifest-editor-actions">
          <Button variant="ghost" size="sm" onClick={onDuplicateAgent}>
            {t('settings.duplicateAgent')}
          </Button>
          {/* A builtin cannot be deleted, only switched off; an override is restored from the header line. */}
          {!builtinUpdate && provenanceScope !== 'builtin' ? (
            <Button variant="danger" size="sm" onClick={onDeleteAgent}>{t('settings.deleteAgent')}</Button>
          ) : null}
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <SettingsSection title={t('settings.agentRouteAvailability')} className="settings-agent-route-panel">
          <div className="settings-agent-route-body">
            <AgentModelBindingFields
              binding={settings.agentModels.byAgent[selectedAgent.id] ?? {}}
              options={settings.agents.modelOptions}
              fallback={settings.agentModels.default}
              onChange={onModelBindingChange}
              testIdPrefix="settings-agent"
              t={t}
            />
            {modelError ? <InlineError>{modelError}</InlineError> : null}
            {statusProblem ? (
              <div className="settings-agent-config-status" data-testid="settings-agent-config-status" data-tone={status.tone}
                role="status" data-tooltip={status.detail}>
                <span className="settings-agent-config-status-dot" aria-hidden="true" />
                {status.label}
              </div>
            ) : null}

            <div className="settings-agent-flags" role="group" aria-label={t('settings.agentAvailability')}>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.agentEnabled')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.enabled} onCheckedChange={(enabled) => onUpdateAgent({ enabled })} aria-label={t('settings.agentEnabled')}
                    disabled={selectedAgent.id === GENERAL_AGENT_ID} data-tooltip={selectedAgent.id === GENERAL_AGENT_ID ? t('settings.agentDefaultRequired') : undefined} />
                </span>
              </label>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.userInvocable')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.userInvocable} onCheckedChange={(userInvocable) => onUpdateAgent({ userInvocable })} aria-label={t('settings.userInvocable')} />
                </span>
              </label>
              <label className="settings-agent-flag">
                <span className="settings-field-label">{t('settings.disableModelInvocation')}</span>
                <span className="settings-switch-row">
                  <Switch checked={selectedAgent.disableModelInvocation} onCheckedChange={(disableModelInvocation) => onUpdateAgent({ disableModelInvocation })} aria-label={t('settings.disableModelInvocation')} />
                </span>
              </label>
            </div>
            <AgentContractFields agent={selectedAgent} onChange={onUpdateAgent} t={t} />
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
                  data-tooltip={open ? undefined : panelHint(id)}
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
                  <span className="settings-agent-panel-title">{panelLabel(id)}</span>
                  <Chevron open={open} className="settings-agent-panel-caret" />
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

        <SettingsDiagnostics
          testId="settings-agent-diagnostics"
          rows={[
            { label: t('settings.resourceFieldId'), value: selectedAgent.id },
            { label: t('settings.resourceScope'), value: provenanceLabel(provenanceScope, t) },
            ...(provenance ? [
              { label: t('settings.scopeResourceLocation'), value: provenance.sourcePath },
              { label: t('settings.contentFingerprint'), value: provenance.sourceHash },
            ] : []),
          ]}
        />
      </div>
    </div>
  );
};
