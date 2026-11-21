import React from 'react';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField, SettingsSection, useSettingsAutosave, type SettingsAutosaveStatus } from '../parts';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
interface PersonalizationSettingsProps {
  globalInstructionsDraft: string;
  /** The saved value; the draft autosaves while it differs. */
  savedGlobalInstructions: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
  t: Translate;
}

function statusText(status: SettingsAutosaveStatus, t: Translate): string {
  if (status === 'saving') return t('settings.saving');
  if (status === 'saved') return t('settings.personalizationSaved');
  if (status === 'error') return t('settings.personalizationSaveFailed');
  return '';
}

export const PersonalizationSettings: React.FC<PersonalizationSettingsProps> = ({
  globalInstructionsDraft,
  savedGlobalInstructions,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
  t,
}) => {
  const { status, flush } = useSettingsAutosave(globalInstructionsDraft,
    globalInstructionsDraft !== savedGlobalInstructions, onSavePersonalization);

  const textareaId = 'settings-global-instructions';

  return (
    <SettingsSection
      className="settings-personalization-block"
      title={t('settings.personalizationTitle')}
      data-settings-search="personalization"
    >
      <SettingsField
        label={t('settings.globalInstructions')}
        description={t('settings.globalInstructionsHint')}
        htmlFor={textareaId}
      >
        <Textarea
          id={textareaId}
          className="settings-agent-instructions settings-personalization-textarea"
          value={globalInstructionsDraft}
          minRows={4}
          onChange={(event) => onGlobalInstructionsDraftChange(event.currentTarget.value)}
          onBlur={flush}
          placeholder={t('settings.globalInstructionsPlaceholder')}
        />
      </SettingsField>
      <span className="settings-save-status" role="status" data-status={status}>{statusText(status, t)}</span>
    </SettingsSection>
  );
};
