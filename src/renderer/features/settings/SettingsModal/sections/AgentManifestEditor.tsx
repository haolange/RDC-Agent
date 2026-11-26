import React from 'react';
import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { Button } from '../../../../ui/Button';
import { ModeGlyph } from '../../../../ui/ModeGlyph';
import { Switch } from '../../../../ui/Switch';
import { CopyDiagnosticsMenu } from '../../../../patterns/CopyDiagnostics';
import { SettingsSection } from '../parts';
import { Badge } from '../../../../ui/Badge';
import { InlineError } from '../../../../ui/InlineError';
import { humanizeError } from '../../../../i18n/humanizeError';
import { useI18n } from '../../../../i18n';
import { PlainButton } from '../../../../ui/PlainButton';
import { AgentContractFields } from './AgentContractFields';
import { AgentModelBindingFields, type AgentModelFieldChange } from './AgentModelBindingFields';
import { configStatus, provenanceLabel } from './agentConfigStatus';
import { AgentEditorPanels } from './AgentEditorPanels';
import type { AgentSkillCatalog } from './AgentSkillPicker';
import type { AppSettings } from '@shared/types/settings';
import type {
  AgentManifestDefinition,
  AgentManifestDraft,
  AgentManifestProvenance,
  AgentModelOption,
} from '@shared/types/agentManifest';

interface AgentManifestEditorProps {
  skills: AgentSkillCatalog;
  settings: AppSettings;
  modelOptions: AgentModelOption[];
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
}

export const AgentManifestEditor: React.FC<AgentManifestEditorProps> = ({
  skills,
  settings,
  modelOptions,
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
}) => {
  const { t } = useI18n();
  const provenanceScope = provenance?.scope ?? null;
  const status = configStatus(selectedAgent, settings, modelOptions, t);
  // A healthy or switched-off Agent says nothing here: the switch already shows it is off.
  const statusProblem = status.tone === 'warning' || status.tone === 'error';
  const agentAccentStyle = useDynStyle({
    '--settings-agent-accent': selectedAgent.accent || '#33d1ff',
  });

  return (
    <div className="settings-manifest-editor" data-testid="settings-agent-manifest-editor">
      <div className="settings-manifest-editor-head">
        <div className="settings-agent-editor-title">
          <span className="settings-agent-editor-icon" aria-hidden="true" {...agentAccentStyle}>
            <ModeGlyph mode={selectedAgent.id} icon={selectedAgent.icon} size={20} strokeWidth={1.9} />
          </span>
          <div className="settings-agent-editor-copy">
            <div className="settings-agent-editor-name-row">
              <span className="settings-agent-editor-name">{selectedAgent.name}</span>
              {provenanceScope ? (
                <Badge
                  tone={provenanceScope === 'builtin' ? 'accent' : 'neutral'}
                  variant="outline"
                  data-testid="settings-agent-provenance"
                >
                  {provenanceLabel(provenanceScope, t)}
                </Badge>
              ) : null}
            </div>
            {description ? <p className="settings-agent-editor-description">{description}</p> : null}
            {builtinUpdate ? (
              <div
                className="settings-agent-editor-override"
                data-testid="settings-agent-override"
                data-tone={builtinUpdate.status === 'updated' ? 'warning' : undefined}
              >
                {/* The change itself is one click away: the comparison, which can also restore. */}
                <PlainButton
                  className="settings-agent-editor-link"
                  onClick={onShowBuiltinDiff}
                  data-testid="settings-agent-builtin-diff-open"
                  data-tooltip={t('settings.agentBuiltinDiffOpen')}
                >
                  {t(
                    builtinUpdate.status === 'updated'
                      ? 'settings.agentBuiltinUpdated'
                      : 'settings.agentOverridesBuiltin',
                  )}
                </PlainButton>
                <PlainButton
                  className="settings-agent-editor-link"
                  onClick={onDeleteAgent}
                  data-testid="settings-agent-restore"
                >
                  {t('settings.agentRestore')}
                </PlainButton>
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
            <Button variant="danger" size="sm" onClick={onDeleteAgent}>
              {t('settings.deleteAgent')}
            </Button>
          ) : null}
          <CopyDiagnosticsMenu
            testId="settings-agent-diagnostics"
            facts={[
              { label: t('settings.resourceFieldId'), value: selectedAgent.id },
              { label: t('settings.resourceScope'), value: provenanceLabel(provenanceScope, t) },
              ...(provenance
                ? [
                    { label: t('settings.scopeResourceLocation'), value: provenance.sourcePath },
                    { label: t('settings.contentFingerprint'), value: provenance.sourceHash },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="settings-manifest-editor-body scrollbar-thin">
        <SettingsSection title={t('settings.agentRouteAvailability')} className="settings-agent-route-panel">
          <div className="settings-agent-route-body">
            <AgentModelBindingFields
              binding={settings.agentModels.byAgent[selectedAgent.id] ?? {}}
              options={modelOptions}
              fallback={settings.agentModels.default}
              onChange={onModelFieldChange}
              testIdPrefix="settings-agent"
            />
            {modelError ? (
              <InlineError detail={modelError}>
                {humanizeError(modelError, t, 'settings.agentModelSaveFailed')}
              </InlineError>
            ) : null}
            {statusProblem ? (
              <div
                className="settings-agent-config-status"
                data-testid="settings-agent-config-status"
                data-tone={status.tone}
                role="status"
                tabIndex={status.detail ? 0 : undefined}
                data-tooltip={status.detail}
              >
                <span className="settings-agent-config-status-dot" aria-hidden="true" />
                {status.label}
              </div>
            ) : null}

            <div className="settings-agent-flags" role="group" aria-label={t('settings.agentAvailability')}>
              <Switch
                className="settings-agent-flag"
                label={t('settings.agentEnabled')}
                checked={selectedAgent.enabled}
                onCheckedChange={(enabled) => onUpdateAgent({ enabled })}
                disabled={selectedAgent.id === GENERAL_AGENT_ID}
                data-tooltip={selectedAgent.id === GENERAL_AGENT_ID ? t('settings.agentDefaultRequired') : undefined}
              />
              <Switch
                className="settings-agent-flag"
                label={t('settings.userInvocable')}
                checked={selectedAgent.userInvocable}
                onCheckedChange={(userInvocable) => onUpdateAgent({ userInvocable })}
              />
              <Switch
                className="settings-agent-flag"
                label={t('settings.modelInvocable')}
                checked={!selectedAgent.disableModelInvocation}
                onCheckedChange={(callable) => onUpdateAgent({ disableModelInvocation: !callable })}
              />
            </div>
            <AgentContractFields agent={selectedAgent} onChange={onUpdateAgent} />
          </div>
        </SettingsSection>

        <AgentEditorPanels
          skills={skills}
          settings={settings}
          selectedAgent={selectedAgent}
          onUpdateAgent={onUpdateAgent}
          agentManifestSaveBlocked={agentManifestSaveBlocked}
        />
      </div>
    </div>
  );
};
