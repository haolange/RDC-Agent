import React, { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { agentDescription } from '../../../../lib/agentDescription';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { SplitButton } from '../../../../ui/SplitButton';
import { EmptyState } from '../../../../ui/EmptyState';
import { Icon } from '../../../../ui/Icon';
import { Chevron } from '../../../../ui/Chevron';
import { SettingsSaveMark, SettingsScopeBar } from '../parts';
import { useScopedSkillSelection } from '../useScopedSkillSelection';
import { useSettingsNavigationStore } from '../../../../stores/settingsNavigationStore';
import { uniqueResourceId } from './uniqueResourceId';
import { createNewAgent, draftScope, toSlug, visibleDrafts, type AgentScope } from './agentDraftFactory';
import { AgentManifestEditor } from './AgentManifestEditor';
import { AgentListItem } from './AgentListItem';
import { AgentManifestDiagnostics } from './AgentManifestDiagnostics';
import { AgentDefaultModelSection } from './AgentDefaultModelSection';
import { AgentBuiltinDiffDialog } from './AgentBuiltinDiffDialog';
import { AgentModelMigrationDialog } from './AgentModelMigrationDialog';
import { ProjectAgentTrustDialog } from './ProjectAgentTrustDialog';
import { NewAgentDialog } from './NewAgentDialog';
import { DEFAULT_MODEL_TARGET, useAgentModelControls, type AgentModelCommands } from './useAgentModelControls';
import type { AgentProvenanceScope } from './agentConfigStatus';
import type { useI18n } from '../../../../i18n';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentsSettingsProps extends AgentModelCommands {
  settings: AppSettings;
  agentManifestDrafts: AgentManifestDraft[];
  agentManifestContextReady: boolean;
  onAgentManifestDraftsChange: Dispatch<SetStateAction<AgentManifestDraft[]>>;
  onRetrySaveAgentManifests: () => void | Promise<unknown>;
  onImportAgentManifest: () => void | Promise<void>;
  agentManifestSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentManifestSaveMessage: string;
  agentManifestSaveBlocked?: boolean;
  /** Whether a project is open; the Project tab is disabled without one. */
  canProject: boolean;
  currentProjectId: string | null;
  t: Translate;
}

export const AgentsSettings: React.FC<AgentsSettingsProps> = ({
  settings,
  agentManifestDrafts,
  agentManifestContextReady,
  onAgentManifestDraftsChange,
  onRetrySaveAgentManifests,
  onImportAgentManifest,
  agentManifestSaveState,
  agentManifestSaveMessage,
  agentManifestSaveBlocked = false,
  canProject,
  currentProjectId,
  t,
  ...modelCommands
}) => {
  const [scope, setScope] = useState<AgentScope>('user');
  const models = useAgentModelControls(settings, modelCommands, t);
  const agentRequest = useSettingsNavigationStore((state) => state.agentRequest);
  const clearAgentRequest = useSettingsNavigationStore((state) => state.clearAgentRequest);
  const [missingAgentId, setMissingAgentId] = useState<string | null>(null);
  const skills = useScopedSkillSelection(scope);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const activeDrafts = visibleDrafts(agentManifestDrafts);
  const scopedDrafts = useMemo(() => activeDrafts.filter((draft) => draftScope(draft) === scope), [activeDrafts, scope]);
  const [selectedAgentId, setSelectedAgentId] = useState(scopedDrafts[0]?.id ?? '');
  const [pendingDelete, setPendingDelete] = useState<AgentManifestDraft | null>(null);
  const [naming, setNaming] = useState(false);
  const selectedAgent = missingAgentId ? null : scopedDrafts.find((agent) => agent.id === selectedAgentId) ?? scopedDrafts[0] ?? null;
  const selectedId = selectedAgent?.id ?? '';
  // A shipped description is shown in the interface language until the user edits it.
  const displayDescription = (agent: AgentManifestDraft): string => {
    const definition = settings.agents.definitions.find((entry) => entry.id === agent.id);
    return definition && definition.description === agent.description
      ? agentDescription(definition, settings.appearance.language) : agent.description;
  };
  const diagnostics = settings.agents.diagnostics ?? [];
  useEffect(() => {
    if (!agentRequest || !agentManifestContextReady) return;
    const target = activeDrafts.find((draft) => draft.id === agentRequest.agentId);
    if (target) {
      setScope(draftScope(target));
      setSelectedAgentId(target.id);
      setMissingAgentId(null);
    } else {
      setMissingAgentId(agentRequest.agentId);
    }
    clearAgentRequest(agentRequest.sequence);
  }, [activeDrafts, agentManifestContextReady, agentRequest, clearAgentRequest]);
  const selectedDefinition = selectedAgent
    ? settings.agents.definitions.find((definition) => definition.id === selectedAgent.id) ?? null
    : null;
  const provenanceScope: AgentProvenanceScope | null = selectedDefinition?.provenance?.scope ?? null;
  const builtinUpdate = provenanceScope === 'builtin' ? undefined : selectedDefinition?.builtinUpdate;

  const updateAgent = (patch: Partial<AgentManifestDraft>) => {
    if (!selectedAgent) return;
    onAgentManifestDraftsChange((current) => current.map((agent) => (
      agent.id === selectedAgent.id ? { ...agent, ...patch } : agent
    )));
  };

  const addAgent = (identity: { name: string; id: string }) => {
    if (scope === 'project' && !currentProjectId) return;
    setMissingAgentId(null);
    setNaming(false);
    onAgentManifestDraftsChange((current) => [...current, createNewAgent(identity, t, scope, currentProjectId)]);
    setSelectedAgentId(identity.id);
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
        basedOn: undefined,
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
    // Removing an override brings the builtin back under the same id, so the selection stays.
    if (!builtinUpdate) setSelectedAgentId(scopedDrafts.find((agent) => agent.id !== target.id)?.id ?? '');
    setPendingDelete(null);
  };

  return (
    <div className="settings-manifest-page">
      <AgentDefaultModelSection
        settings={settings}
        error={models.modelError?.target === DEFAULT_MODEL_TARGET ? models.modelError.message : null}
        onChange={models.setDefaultBinding}
        t={t}
      />
      <div className="settings-manifest-toolbar settings-manifest-page-toolbar" data-testid="settings-agents-toolbar">
        <SettingsScopeBar
          scope={scope}
          onScopeChange={(next) => { clearAgentRequest(); setMissingAgentId(null); setScope(next); }}
          canProject={canProject}
          userLabel={t('settings.scopeUser')}
          projectLabel={t('settings.scopeProject')}
          groupLabel={t('settings.resourceScope')}
        />
        {/* Agents autosave: one mark for the page. A blocked save names what to fix; a failed one can be retried. */}
        <SettingsSaveMark
          status={agentManifestSaveState}
          savingLabel={t('settings.saving')}
          savedLabel={t('settings.agentManifestSaved')}
          errorLabel={agentManifestSaveBlocked && agentManifestSaveMessage ? agentManifestSaveMessage : t('settings.agentManifestSaveFailed')}
          errorDetail={agentManifestSaveBlocked ? undefined : agentManifestSaveMessage || undefined}
          onRetry={agentManifestSaveBlocked ? undefined : () => void onRetrySaveAgentManifests()}
          retryLabel={t('settings.retry')}
          testId="settings-agent-autosave-status"
        />
      </div>

      <AgentManifestDiagnostics open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} diagnostics={diagnostics}
        onMigrate={(issue) => models.openOverrideAction('migrate', issue)}
        onDeleteOverride={(issue) => models.openOverrideAction('delete', issue)}
        onReviewTrust={models.openTrustReview} t={t} />
      {missingAgentId ? <p role="alert">{t('settings.agentNavigationNotFound', { id: missingAgentId })}</p> : null}
      <div className="settings-manifest-layout">
        <div className="settings-manifest-list-column">
          <div className="settings-manifest-list-toolbar">
            <span className="settings-manifest-count">
              {t('settings.agentListCount', { count: scopedDrafts.length })}
            </span>
            <SplitButton dataTestId="settings-agent-create" label={t('settings.newAgent')} onClick={() => setNaming(true)}
              disabled={scope === 'project' && !currentProjectId} menuLabel={t('settings.newAgentMore')}
              items={[{ id: 'import', label: t('settings.importAgentManifest'), onSelect: () => void onImportAgentManifest() }]} />
          </div>

          <div className="settings-manifest-list" aria-label={t('settings.agentManifestTitle')}>
            {scopedDrafts.length === 0 ? (
              <EmptyState
                className="settings-manifest-list-empty"
                title={t('settings.agentScopeEmpty', { scope: scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser') })}
              />
            ) : scopedDrafts.map((agent) => (
              <AgentListItem
                key={agent.id}
                id={agent.id}
                name={agent.name}
                description={displayDescription(agent)}
                icon={agent.icon}
                selected={agent.id === selectedId}
                onSelect={() => { clearAgentRequest(); setMissingAgentId(null); setSelectedAgentId(agent.id); }}
              />
            ))}
          </div>

          {diagnostics.length > 0 ? (
            <div className="settings-agent-tool-diagnostics settings-agent-diagnostics-row" data-testid="settings-agent-manifest-diagnostics">
              <Button
                variant="secondary" size="sm" aria-haspopup="dialog"
                className="settings-agent-diagnostics-toggle"
                aria-expanded={diagnosticsOpen}
                onClick={() => setDiagnosticsOpen(true)}
              >
                <Icon name="warning" size={14} className="settings-agent-diagnostics-icon" />
                <span>{t('settings.agentDiagnosticsCount', { count: diagnostics.length })}</span>
                <span className="settings-agent-diagnostics-link">{t('settings.agentDiagnosticsView')}</span>
                <Chevron />
              </Button>
            </div>
          ) : null}
        </div>

        {selectedAgent ? (
          <AgentManifestEditor
            skills={skills}
            settings={settings}
            selectedAgent={selectedAgent}
            provenance={selectedDefinition?.provenance ?? null}
            builtinUpdate={builtinUpdate}
            description={displayDescription(selectedAgent)}
            onUpdateAgent={updateAgent}
            onModelBindingChange={(binding) => models.setAgentBinding(selectedAgent.id, binding)}
            modelError={models.modelError?.target === selectedAgent.id ? models.modelError.message : null}
            onDuplicateAgent={duplicateAgent}
            onDeleteAgent={deleteAgent}
            onShowBuiltinDiff={() => models.showBuiltinDiff(selectedAgent, builtinUpdate?.status === 'updated')}
            agentManifestSaveBlocked={agentManifestSaveBlocked}
            t={t}
          />
        ) : (
          <div className="settings-runtime-editor-placeholder">
            <EmptyState variant="page" title={t('settings.agentSelectOrCreate')} />
          </div>
        )}
      </div>
      {models.builtinDiff ? (
        <AgentBuiltinDiffDialog
          state={models.builtinDiff}
          onClose={models.closeBuiltinDiff}
          onRestore={() => { models.closeBuiltinDiff(); deleteAgent(); }}
          t={t}
        />
      ) : null}
      {models.overrideAction ? (
        <AgentModelMigrationDialog
          target={models.overrideAction}
          options={settings.agents.modelOptions}
          onConfirm={models.confirmOverrideAction}
          onClose={models.closeOverrideAction}
          t={t}
        />
      ) : null}
      {models.trustReview ? (
        <ProjectAgentTrustDialog
          review={models.trustReview}
          onConfirm={models.confirmTrust}
          onClose={models.closeTrustReview}
          t={t}
        />
      ) : null}
      {naming ? (
        <NewAgentDialog scopeLabel={scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser')}
          existingIds={agentManifestDrafts.map((agent) => agent.id)} onCreate={addAgent} onClose={() => setNaming(false)} t={t} />
      ) : null}
      {pendingDelete ? (
        <ConfirmationDialog
          title={t(builtinUpdate ? 'settings.agentRestoreBuiltinTitle' : 'settings.deleteAgentTitle')}
          message={t(builtinUpdate ? 'settings.agentRestoreBuiltinConfirm' : 'settings.deleteAgentConfirm', { name: pendingDelete.name || pendingDelete.id })}
          details={[
            { label: t('settings.agentName'), value: pendingDelete.name || pendingDelete.id },
            { label: t('settings.resourceFieldId'), value: pendingDelete.id },
          ]}
          confirmLabel={t(builtinUpdate ? 'settings.agentRestoreBuiltin' : 'dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDeleteAgent}
        />
      ) : null}
    </div>
  );
};
