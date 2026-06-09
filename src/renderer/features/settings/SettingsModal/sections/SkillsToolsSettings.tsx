import React, { type Dispatch, type SetStateAction } from 'react';
import type { AppSettings, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';

type Translate = ReturnType<typeof useI18n>['t'];

interface SkillsToolsSettingsProps {
  settings: AppSettings;
  enabledSkillDrafts: string[];
  enabledMcpDrafts: string[];
  rdxCliDraft: RdxCliInvokerSettings;
  globalInstructionsDraft: string;
  onEnabledSkillDraftsChange: Dispatch<SetStateAction<string[]>>;
  onEnabledMcpDraftsChange: Dispatch<SetStateAction<string[]>>;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onGlobalInstructionsDraftChange: Dispatch<SetStateAction<string>>;
  onSave: () => void | Promise<void>;
  toggleRuntimeId: (values: string[], id: string) => string[];
  t: Translate;
}

export const SkillsToolsSettings: React.FC<SkillsToolsSettingsProps> = ({
  settings,
  enabledSkillDrafts,
  enabledMcpDrafts,
  rdxCliDraft,
  globalInstructionsDraft,
  onEnabledSkillDraftsChange,
  onEnabledMcpDraftsChange,
  onRdxCliDraftChange,
  onGlobalInstructionsDraftChange,
  onSave,
  toggleRuntimeId,
  t,
}) => (
  <section className="settings-page settings-page-tools">
    <div className="settings-tools-page">
      <div className="settings-agent-page-header">
        <div>
          <div className="settings-agent-page-title">{t('settings.skillsAndTools')}</div>
          <div className="settings-agent-page-subtitle">{t('settings.skillsAndToolsHint')}</div>
        </div>
      </div>

      <div className="settings-tools-grid">
        <div className="settings-tool-section">
          <div className="settings-field-label">{t('settings.skills')}</div>
          <div className="settings-help-text">{t('settings.skillsHint')}</div>
          <div className="user-menu-pill-group settings-inline-pills">
            {settings.configuration.availableSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className={`user-menu-pill ${enabledSkillDrafts.includes(skill.id) ? 'active' : ''}`}
                data-testid={`settings-skill-${skill.id}`}
                title={skill.description}
                onClick={() => onEnabledSkillDraftsChange((current) => toggleRuntimeId(current, skill.id))}
              >
                {skill.label}
              </button>
            ))}
            {settings.configuration.availableSkills.length === 0 && (
              <span className="settings-help-text">{t('settings.noSkillsConfigured')}</span>
            )}
          </div>
        </div>

        <div className="settings-tool-section">
          <div className="settings-field-label">{t('settings.mcp')}</div>
          <div className="settings-help-text">{t('settings.mcpHint')}</div>
          <div className="user-menu-pill-group settings-inline-pills">
            {settings.configuration.availableMcpServers.map((server) => (
              <button
                key={server.id}
                type="button"
                className={`user-menu-pill ${enabledMcpDrafts.includes(server.id) ? 'active' : ''}`}
                data-testid={`settings-mcp-${server.id}`}
                title={server.description}
                onClick={() => onEnabledMcpDraftsChange((current) => toggleRuntimeId(current, server.id))}
              >
                {server.name}
              </button>
            ))}
            {settings.configuration.availableMcpServers.length === 0 && (
              <span className="settings-help-text">{t('settings.noMcpConfigured')}</span>
            )}
          </div>
        </div>
      </div>

      <RdxCliInvokerSettingsFields
        rdxCliDraft={rdxCliDraft}
        onRdxCliDraftChange={onRdxCliDraftChange}
        t={t}
      />

      <div className="settings-tool-section">
        <div className="settings-field-label">{t('settings.globalInstructions')}</div>
        <div className="settings-help-text">{t('settings.globalInstructionsHint')}</div>
        <textarea
          className="input settings-agent-instructions"
          value={globalInstructionsDraft}
          onChange={(event) => onGlobalInstructionsDraftChange(event.currentTarget.value)}
          placeholder={t('settings.globalInstructionsPlaceholder')}
        />
      </div>

      <div className="settings-actions">
        <button type="button" className="button button-primary" data-testid="settings-agent-runtime-save" onClick={() => void onSave()}>
          {t('settings.saveSkillsAndTools')}
        </button>
      </div>
    </div>
  </section>
);
