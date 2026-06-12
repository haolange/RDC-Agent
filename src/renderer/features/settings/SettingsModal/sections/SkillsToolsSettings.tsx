import React, { type Dispatch, type SetStateAction } from 'react';
import type { AppSettings, RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';

type Translate = ReturnType<typeof useI18n>['t'];

interface SkillsToolsSettingsProps {
  settings: AppSettings;
  enabledSkillDrafts: string[];
  enabledMcpDrafts: string[];
  rdxCliDraft: RdxCliInvokerSettings;
  rdxActionsDraft: RdxActionSettingsMap;
  globalInstructionsDraft: string;
  onEnabledSkillDraftsChange: Dispatch<SetStateAction<string[]>>;
  onEnabledMcpDraftsChange: Dispatch<SetStateAction<string[]>>;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
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
  rdxActionsDraft,
  globalInstructionsDraft,
  onEnabledSkillDraftsChange,
  onEnabledMcpDraftsChange,
  onRdxCliDraftChange,
  onRdxActionsDraftChange,
  onGlobalInstructionsDraftChange,
  onSave,
  toggleRuntimeId,
  t,
}) => {
  const availableSkillCount = settings.configuration.availableSkills.length;
  const availableMcpCount = settings.configuration.availableMcpServers.length;

  return (
    <section className="settings-page settings-page-tools">
      <div className="settings-tools-page">
        <div className="settings-agent-page-header">
          <div>
            <div className="settings-agent-page-title">{t('settings.skillsAndTools')}</div>
            <div className="settings-agent-page-subtitle">{t('settings.skillsAndToolsHint')}</div>
          </div>
        </div>

        <div className="settings-tools-overview" aria-label={t('settings.configurationSummary')}>
          <div className="settings-product-summary-card">
            <span>{t('settings.enabledSkillsSummary')}</span>
            <strong>{enabledSkillDrafts.length} / {availableSkillCount}</strong>
          </div>
          <div className="settings-product-summary-card">
            <span>{t('settings.enabledMcpSummary')}</span>
            <strong>{enabledMcpDrafts.length} / {availableMcpCount}</strong>
          </div>
          <div className="settings-product-summary-card">
            <span>{t('settings.toolchainSummary')}</span>
            <strong>{rdxCliDraft.enabled ? t('settings.enabled') : t('settings.disabled')}</strong>
          </div>
        </div>

        <div className="settings-tools-grid">
          <div className="settings-tool-section settings-tool-section--capability">
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

          <div className="settings-tool-section settings-tool-section--capability">
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
          rdxActionsDraft={rdxActionsDraft}
          onRdxCliDraftChange={onRdxCliDraftChange}
          onRdxActionsDraftChange={onRdxActionsDraftChange}
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
};
