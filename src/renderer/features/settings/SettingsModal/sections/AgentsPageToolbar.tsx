import { SettingsSaveMark, SettingsScopeBar } from '../parts';
import { useI18n } from '../../../../i18n';
import type { AgentScope } from './agentDraftFactory';

/** The Agents page's scope switch and its one autosave mark. */
export function AgentsPageToolbar({
  scope,
  canProject,
  onScopeChange,
  saveState,
  saveMessage,
  saveBlocked,
  onRetrySave,
}: {
  scope: AgentScope;
  canProject: boolean;
  onScopeChange: (scope: AgentScope) => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveMessage: string;
  saveBlocked: boolean;
  onRetrySave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-manifest-toolbar settings-manifest-page-toolbar" data-testid="settings-agents-toolbar">
      <SettingsScopeBar
        scope={scope}
        onScopeChange={onScopeChange}
        canProject={canProject}
        userLabel={t('settings.scopeUser')}
        projectLabel={t('settings.scopeProject')}
        groupLabel={t('settings.resourceScope')}
      />
      {/* Agents autosave: one mark for the page. A blocked save names what to fix; a failed one can be retried. */}
      <SettingsSaveMark
        status={saveState}
        savingLabel={t('settings.saving')}
        savedLabel={t('settings.agentManifestSaved')}
        errorLabel={saveBlocked && saveMessage ? saveMessage : t('settings.agentManifestSaveFailed')}
        errorDetail={saveBlocked ? undefined : saveMessage || undefined}
        onRetry={saveBlocked ? undefined : onRetrySave}
        retryLabel={t('settings.retry')}
        testId="settings-agent-autosave-status"
      />
    </div>
  );
}
