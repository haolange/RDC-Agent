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
import { CopyDiagnosticsMenu } from '../../../../patterns/CopyDiagnostics';
import { SettingsSection } from '../parts';
import { Badge } from '../../../../ui/Badge';
import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { AgentContractFields } from './AgentContractFields';
import { AgentIdentityPanel } from './AgentIdentityPanel';
import { AgentCapabilityPicker, buildAgentCapabilityGroups } from './AgentCapabilityPicker';
import { AgentHandoffEditor } from './AgentHandoffEditor';
import { AgentModelBindingFields, type AgentModelFieldChange } from './AgentModelBindingFields';
import { configStatus, provenanceLabel } from './agentConfigStatus';
import { agentPanelSummary, type AgentPanel } from './agentPanelSummary';
import { AgentExecutionLimitField } from './AgentExecutionLimitField';
import type { AgentSkillCatalog } from './AgentSkillPicker';
import type { useI18n } from '../../../../i18n';
import type { AppSettings } from '@shared/types/settings';
import type { AgentManifestDefinition, AgentManifestDraft, AgentManifestProvenance } from '@shared/types/agentManifest';

type Translate = ReturnType<typeof useI18n>['t'];
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
  onModelFieldChange: (change: AgentModelFieldChange) => void;
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
  onModelFieldChange,
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
            <InlineError data-testid="settings-agent-tool-diagnostics"
              detail={toolDiagnostics.map(item => `${item.token} · ${item.message}`).join('\n')}>
              {t('settings.agentToolDiagnosticsTitle')}
            </InlineError>
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
            <div className="settings-agent-editor-name-row">
              <span className="settings-agent-editor-name">{selectedAgent.name}</span>
              {provenanceScope ? (
                <Badge tone={provenanceScope === 'builtin' ? 'accent' : 'neutral'} variant="outline" data-testid="settings-agent-provenance">
                  {provenanceLabel(provenanceScope, t)}
                </Badge>
              ) : null}
            </div>
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
          <CopyDiagnosticsMenu testId="settings-agent-diagnostics" facts={[
            { label: t('settings.resourceFieldId'), value: selectedAgent.id },
            { label: t('settings.resourceScope'), value: provenanceLabel(provenanceScope, t) },
            ...(provenance ? [
              { label: t('settings.scopeResourceLocation'), value: provenance.sourcePath },
              { label: t('settings.contentFingerprint'), value: provenance.sourceHash },
            ] : []),
          ]} />
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <SettingsSection title={t('settings.agentRouteAvailability')} className="settings-agent-route-panel">
          <div className="settings-agent-route-body">
            <AgentModelBindingFields
              binding={settings.agentModels.byAgent[selectedAgent.id] ?? {}}
              options={settings.agents.modelOptions}
              fallback={settings.agentModels.default}
              onChange={onModelFieldChange}
              testIdPrefix="settings-agent"
              t={t}
            />
            {modelError ? <InlineError detail={modelError}>{humanizeError(modelError, t, 'settings.agentModelSaveFailed')}</InlineError> : null}
            {statusProblem ? (
              <div className="settings-agent-config-status" data-testid="settings-agent-config-status" data-tone={status.tone}
                role="status" tabIndex={status.detail ? 0 : undefined} data-tooltip={status.detail}>
                <span className="settings-agent-config-status-dot" aria-hidden="true" />
                {status.label}
              </div>
            ) : null}

            <div className="settings-agent-flags" role="group" aria-label={t('settings.agentAvailability')}>
              <Switch className="settings-agent-flag" label={t('settings.agentEnabled')} checked={selectedAgent.enabled}
                onCheckedChange={(enabled) => onUpdateAgent({ enabled })} disabled={selectedAgent.id === GENERAL_AGENT_ID}
                data-tooltip={selectedAgent.id === GENERAL_AGENT_ID ? t('settings.agentDefaultRequired') : undefined} />
              <Switch className="settings-agent-flag" label={t('settings.userInvocable')} checked={selectedAgent.userInvocable}
                onCheckedChange={(userInvocable) => onUpdateAgent({ userInvocable })} />
              <Switch className="settings-agent-flag" label={t('settings.modelInvocable')} checked={!selectedAgent.disableModelInvocation}
                onCheckedChange={(callable) => onUpdateAgent({ disableModelInvocation: !callable })} />
            </div>
            <AgentContractFields agent={selectedAgent} onChange={onUpdateAgent} t={t} />
          </div>
        </SettingsSection>

        <div className="settings-agent-panels" data-testid="settings-agent-panels">
          {PANELS.map(({ id, icon }) => {
            const open = openPanel === id;
            const summary = !open && agentPanelSummary(id, selectedAgent, settings, t);
            return (
              <section key={id} className={`settings-agent-panel${open ? ' is-open' : ''}`} data-panel={id}>
                <Button variant="ghost"
                  className="settings-agent-panel-toggle"
                  data-tooltip={open ? undefined : panelHint(id)}
                  aria-expanded={open}
                  aria-controls={open ? `settings-agent-panel-body-${id}` : undefined}
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
                    {summary && <span className="settings-agent-panel-summary">{summary}</span>}
                  </span>
                  <Chevron open={open} className="settings-agent-panel-caret" />
                </Button>
                {open ? (
                  <div id={`settings-agent-panel-body-${id}`} className="settings-agent-panel-body">
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
