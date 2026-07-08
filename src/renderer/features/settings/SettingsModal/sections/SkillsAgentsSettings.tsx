import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AgentRuntimeSkillWriteRequest } from '@shared/types/agentRuntime';
import type { AppSettings } from '@shared/types/settings';
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
  agentManifestDrafts: AgentManifestDraft[];
  onAgentManifestDraftsChange: Dispatch<SetStateAction<AgentManifestDraft[]>>;
  onRetrySaveAgentManifests: () => void | Promise<unknown>;
  onImportAgentManifest: () => void | Promise<void>;
  agentManifestSaveState: 'idle' | 'saving' | 'saved' | 'error';
  agentManifestSaveMessage: string;
  t: Translate;
}

export const SkillsAgentsSettings: React.FC<SkillsAgentsSettingsProps> = ({
  settings,
  onUpsertSkill,
  onDeleteSkill,
  onImportSkill,
  agentManifestDrafts,
  onAgentManifestDraftsChange,
  onRetrySaveAgentManifests,
  onImportAgentManifest,
  agentManifestSaveState,
  agentManifestSaveMessage,
  t,
}) => {
  const [capabilityTab, setCapabilityTab] = useState<CapabilityTab>('skills');
  const agentCount = agentManifestDrafts.filter((agent) => !agent.delete).length;

  return (
    <section className="settings-page settings-page-skills-agents">
      <div className="settings-library-tabs settings-skills-agents-tabs" role="tablist" aria-label={t('settings.skillsAgentsTitle')}>
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
              agentManifestDrafts={agentManifestDrafts}
              onAgentManifestDraftsChange={onAgentManifestDraftsChange}
              onRetrySaveAgentManifests={onRetrySaveAgentManifests}
              onImportAgentManifest={onImportAgentManifest}
              agentManifestSaveState={agentManifestSaveState}
              agentManifestSaveMessage={agentManifestSaveMessage}
              t={t}
            />
          )}
    </section>
  );
};
