import React, { useState } from 'react';
import type { AgentRuntimeSkillDescriptor, AgentRuntimeSkillWriteRequest } from '@shared/types/agentRuntime';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';

type Translate = ReturnType<typeof useI18n>['t'];

interface SkillLibrarySettingsProps {
  settings: AppSettings;
  onUpsertSkill: (request: AgentRuntimeSkillWriteRequest) => Promise<AppSettings>;
  onDeleteSkill: (skillId: string) => Promise<AppSettings>;
  onImportSkill: () => Promise<AppSettings>;
  t: Translate;
}

interface SkillEditorDraft {
  previousId?: string;
  id: string;
  label: string;
  description: string;
  markdown: string;
}

const getSkillMarkdown = (skill: AgentRuntimeSkillDescriptor): string =>
  typeof skill.parameters?.markdown === 'string'
    ? skill.parameters.markdown
    : `# ${skill.label}\ndescription: ${skill.description}\ntype: prompt\npromptTemplate: |\n  `;

const toSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-skill';

const createNewDraft = (skills: AgentRuntimeSkillDescriptor[]): SkillEditorDraft => {
  const existing = new Set(skills.map((skill) => skill.id));
  let index = 1;
  let id = 'custom-skill';
  while (existing.has(id)) {
    index += 1;
    id = `custom-skill-${index}`;
  }
  return {
    id,
    label: 'Custom Skill',
    description: 'Describe when this Skill should be used.',
    markdown: '# Custom Skill\ndescription: Describe when this Skill should be used.\ntype: prompt\npromptTemplate: |\n  Write the reusable workflow or instruction here.\n',
  };
};

const editDraftFromSkill = (skill: AgentRuntimeSkillDescriptor): SkillEditorDraft => ({
  previousId: skill.id,
  id: skill.id,
  label: skill.label,
  description: skill.description,
  markdown: getSkillMarkdown(skill),
});

const RowIcon: React.FC<{ kind: 'edit' | 'delete' | 'import' | 'add' }> = ({ kind }) => {
  const content = (() => {
    switch (kind) {
      case 'edit':
        return <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 6.5l3 3" />;
      case 'delete':
        return <><path d="M5 7h14" /><path d="M10 11v6M14 11v6" /><path d="M9 7l1-2h4l1 2" /><path d="M7 7l1 13h8l1-13" /></>;
      case 'import':
        return <><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 15v4h14v-4" /></>;
      case 'add':
        return <><path d="M12 5v14" /><path d="M5 12h14" /></>;
      default:
        return null;
    }
  })();
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
};

export const SkillLibrarySettings: React.FC<SkillLibrarySettingsProps> = ({
  settings,
  onUpsertSkill,
  onDeleteSkill,
  onImportSkill,
  t,
}) => {
  const [editorDraft, setEditorDraft] = useState<SkillEditorDraft | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState('');
  const [status, setStatus] = useState('');
  const skills = settings.configuration.availableSkills;

  const runAction = async (action: () => Promise<AppSettings>, message: string) => {
    setStatus(t('settings.saving'));
    await action();
    setStatus(message);
  };

  const saveEditor = async () => {
    if (!editorDraft) return;
    await runAction(
      () => onUpsertSkill({
        previousId: editorDraft.previousId,
        id: toSlug(editorDraft.id),
        label: editorDraft.label,
        description: editorDraft.description,
        markdown: editorDraft.markdown,
        enabledByDefault: true,
      }),
      t('settings.skillSaved'),
    );
    setEditorDraft(null);
  };

  return (
    <div className="settings-browser-block" data-testid="settings-skills-block">
      <div className="settings-browser-section-head">
        <div>
          <div className="settings-browser-section-title">{t('settings.skills')}</div>
          <div className="settings-help-text">{t('settings.skillsMdHint')}</div>
        </div>
        <div className="settings-browser-actions">
          <button type="button" className="button button-secondary" onClick={() => void runAction(onImportSkill, t('settings.skillImported'))}>
            <RowIcon kind="import" />
            {t('settings.importSkill')}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setEditorDraft(createNewDraft(skills))}>
            <RowIcon kind="add" />
            {t('settings.newSkill')}
          </button>
        </div>
      </div>

      <div className="settings-row-list" aria-label={t('settings.skills')}>
        {skills.map((skill) => {
          const isPendingDelete = pendingDeleteId === skill.id;
          return (
            <div
              key={skill.id}
              className="settings-managed-row settings-skill-row"
              data-testid={`settings-skill-${skill.id}`}
            >
              <div className="settings-managed-row-main" data-tooltip={skill.description || skill.label} title={skill.description || skill.label}>
                <strong>{skill.label}</strong>
                <span>{skill.description || skill.id}</span>
              </div>
              <div className="settings-row-actions">
                <button type="button" className="button button-ghost settings-icon-button settings-row-action" onClick={() => setEditorDraft(editDraftFromSkill(skill))} aria-label={t('settings.edit')}>
                  <RowIcon kind="edit" />
                </button>
                <button
                  type="button"
                  className={`button ${isPendingDelete ? 'button-danger' : 'button-ghost'} settings-icon-button settings-row-action`}
                  onClick={() => {
                    if (!isPendingDelete) {
                      setPendingDeleteId(skill.id);
                      return;
                    }
                    void runAction(() => onDeleteSkill(skill.id), t('settings.skillDeleted'));
                    setPendingDeleteId('');
                  }}
                  aria-label={t('settings.delete')}
                >
                  <RowIcon kind="delete" />
                </button>
              </div>
            </div>
          );
        })}
        {skills.length === 0 && (
          <div className="settings-browser-empty">
            <strong>{t('settings.noSkillsConfigured')}</strong>
            <span>{t('settings.noSkillsConfiguredHint')}</span>
          </div>
        )}
      </div>

      {editorDraft && (
        <div className="settings-editor-dialog-backdrop" data-testid="settings-skill-editor">
          <div className="settings-editor-dialog settings-skill-editor-dialog" role="dialog" aria-modal="true" aria-label={editorDraft.previousId ? t('settings.editSkill') : t('settings.newSkill')}>
            <div className="settings-editor-dialog-head">
              <strong>{editorDraft.previousId ? t('settings.editSkill') : t('settings.newSkill')}</strong>
              <button type="button" className="button button-ghost settings-icon-button" onClick={() => setEditorDraft(null)} aria-label={t('settings.cancel')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="settings-editor-dialog-body scrollbar-thin">
              <div className="settings-manifest-form-grid">
                <label className="settings-field"><span className="settings-field-label">ID</span><input className="input" value={editorDraft.id} onChange={(event) => setEditorDraft({ ...editorDraft, id: event.currentTarget.value })} /></label>
                <label className="settings-field"><span className="settings-field-label">{t('settings.label')}</span><input className="input" value={editorDraft.label} onChange={(event) => setEditorDraft({ ...editorDraft, label: event.currentTarget.value })} /></label>
              </div>
              <label className="settings-field"><span className="settings-field-label">{t('settings.agentDescription')}</span><input className="input" value={editorDraft.description} onChange={(event) => setEditorDraft({ ...editorDraft, description: event.currentTarget.value })} /></label>
              <div className="settings-skill-editor-layout">
                <label className="settings-field settings-skill-markdown-field">
                  <span className="settings-field-label">Markdown</span>
                  <AutosizeTextarea maxHeight={520} className="input settings-code-textarea" value={editorDraft.markdown} onChange={(event) => setEditorDraft({ ...editorDraft, markdown: event.currentTarget.value })} />
                </label>
                <section className="settings-skill-preview" aria-label="Markdown preview">
                  <div className="settings-field-label">Preview</div>
                  <div className="settings-skill-preview-card">
                    <strong>{editorDraft.label || editorDraft.id}</strong>
                    <span>{editorDraft.description}</span>
                    <pre>{editorDraft.markdown}</pre>
                  </div>
                </section>
              </div>
            </div>
            <div className="settings-actions settings-editor-dialog-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditorDraft(null)}>{t('settings.cancel')}</button>
              <button type="button" className="button button-primary" onClick={() => void saveEditor()}>{t('settings.save')}</button>
            </div>
          </div>
        </div>
      )}

      {status ? (
        <div className="settings-actions settings-actions-split">
          <span className="settings-save-status">{status}</span>
        </div>
      ) : null}
    </div>
  );
};
