import React from 'react';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsSaveMark, SettingsSection, useSettingsAutosave } from '../parts';
import { useI18n } from '../../../../i18n';

interface PersonalizationSettingsProps {
  globalInstructionsDraft: string;
  /** The saved value; the draft autosaves while it differs. */
  savedGlobalInstructions: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
}

export const PersonalizationSettings: React.FC<PersonalizationSettingsProps> = ({
  globalInstructionsDraft,
  savedGlobalInstructions,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
}) => {
  const { t } = useI18n();
  const { status, flush } = useSettingsAutosave(globalInstructionsDraft,
    globalInstructionsDraft !== savedGlobalInstructions, onSavePersonalization);
  const textareaId = 'settings-global-instructions';

  return (
    <SettingsSection variant="rows" title={t('settings.globalInstructions')}
      description={t('settings.globalInstructionsHelp')}
      data-settings-search="personalization"
      actions={<SettingsSaveMark status={status} savingLabel={t('settings.saving')} savedLabel={t('settings.personalizationSaved')}
        errorLabel={t('settings.personalizationSaveFailed')} onRetry={flush} retryLabel={t('settings.retry')} />}>
        <Textarea
          id={textareaId}
          className="settings-agent-instructions settings-personalization-textarea"
          value={globalInstructionsDraft}
          minRows={4}
          onChange={(event) => onGlobalInstructionsDraftChange(event.currentTarget.value)}
          onBlur={flush}
          aria-label={t('settings.globalInstructions')}
        />
    </SettingsSection>
  );
};
