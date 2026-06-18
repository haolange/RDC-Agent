import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AgentRuntimeSkillWriteRequest } from '@shared/types/agentRuntime';
import type { AgentPermissionMode, AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AgentsSettings } from './AgentsSettings';
import { SkillLibrarySettings } from './SkillLibrarySettings';

type Translate = ReturnType<typeof useI18n>['t'];
type CapabilityTab = 'skills' | 'agents';

interface SkillsAgentsSettingsProps {
  settings: AppSettings;
  onUpsertSkill: (request: AgentRuntimeSkillWriteRequest) => Promise<AppSettings>;
  onDeleteSkill: (skillId: string) => Promise<AppSettings>;
  onImportSkill: () => Promise<AppSettings>;
  permissionModeDraft: AgentPermissionMode;
  readableRootsDraft: string;
  writableRootsDraft: string;
  onPermissionModeDraftChange: (mode: AgentPermissionMode) => void;
  onReadableRootsDraftChange: (value: string) => void;
  onWritableRootsDraftChange: (value: string) => void;
  onSaveAgentPermissions: () => void | Promise<void>;
  agentManifestDrafts: AgentManifestDraft[];
  onAgentManifestDraftsChange: Dispatch<SetStateAction<AgentManifestDraft[]>>;
  onSaveAgentManifests: () => void | Promise<void>;
  onImportAgentManifest: () => void | Promise<void>;
  agentRouteSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentRouteSaveMessage: string;
  t: Translate;
}

export const SkillsAgentsSettings: React.FC<SkillsAgentsSettingsProps> = ({
  settings,
  onUpsertSkill,
  onDeleteSkill,
  onImportSkill,
  permissionModeDraft,
  readableRootsDraft,
  writableRootsDraft,
  onPermissionModeDraftChange,
  onReadableRootsDraftChange,
  onWritableRootsDraftChange,
  onSaveAgentPermissions,
  agentManifestDrafts,
  onAgentManifestDraftsChange,
  onSaveAgentManifests,
  onImportAgentManifest,
  agentRouteSaveState,
  agentRouteSaveMessage,
  t,
}) => {
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>('skills');
  const agentCount = agentManifestDrafts.filter((agent) => !agent.delete).length;

  return (
    <section className="settings-page settings-page-skills-agents">
      <div className="settings-library-tabs settings-browser-tabs settings-subpage-tabs settings-subpage-tabs--primary" role="tablist" aria-label={t('settings.skillsAgentsTitle')}>
            <button type="button" className={`settings-library-tab ${capabilityTab === 'skills' ? 'active' : ''}`} role="tab" aria-selected={capabilityTab === 'skills'} onClick={() => setCapabilityTab('skills')}>
              {t('settings.skills')}<span>{settings.configuration.availableSkills.length}</span>
            </button>
            <button type="button" className={`settings-library-tab ${capabilityTab === 'agents' ? 'active' : ''}`} role="tab" aria-selected={capabilityTab === 'agents'} onClick={() => setCapabilityTab('agents')}>
              {t('settings.agentManifestTitle')}<span>{agentCount}</span>
            </button>
          </div>

          {capabilityTab === 'skills' ? (
            <SkillLibrarySettings
              settings={settings}
              onUpsertSkill={onUpsertSkill}
              onDeleteSkill={onDeleteSkill}
              onImportSkill={onImportSkill}
              t={t}
            />
          ) : (
            <AgentsSettings
              settings={settings}
              permissionModeDraft={permissionModeDraft}
              readableRootsDraft={readableRootsDraft}
              writableRootsDraft={writableRootsDraft}
              onPermissionModeDraftChange={onPermissionModeDraftChange}
              onReadableRootsDraftChange={onReadableRootsDraftChange}
              onWritableRootsDraftChange={onWritableRootsDraftChange}
              onSaveAgentPermissions={onSaveAgentPermissions}
              agentManifestDrafts={agentManifestDrafts}
              onAgentManifestDraftsChange={onAgentManifestDraftsChange}
              onSaveAgentManifests={onSaveAgentManifests}
              onImportAgentManifest={onImportAgentManifest}
              agentRouteSaveState={agentRouteSaveState}
              agentRouteSaveMessage={agentRouteSaveMessage}
              t={t}
            />
          )}
    </section>
  );
};
