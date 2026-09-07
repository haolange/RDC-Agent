import React, { useState } from 'react';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsSection } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];

interface PersonalizationSettingsProps {
  globalInstructionsDraft: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
  embedded?: boolean;
  t: Translate;
}

export const PersonalizationSettings: React.FC<PersonalizationSettingsProps> = ({
  globalInstructionsDraft,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
  embedded = false,
  t,
}) => {
  const [status, setStatus] = useState('');

  const save = async () => {
    setStatus(t('settings.saving'));
    await onSavePersonalization();
    setStatus(t('settings.personalizationSaved'));
  };

  const block = (
    <SettingsSection
      className="settings-personalization-block"
      title={t('settings.globalInstructions')}
      description={t('settings.globalInstructionsHint')}
    >
      <Textarea
        className="settings-agent-instructions settings-personalization-textarea"
        value={globalInstructionsDraft}
        onChange={(event) => onGlobalInstructionsDraftChange(event.currentTarget.value)}
        placeholder={t('settings.globalInstructionsPlaceholder')}
        rows={8}
      />
      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status">{status}</span>
        <Button variant="primary" onClick={() => void save()}>
          {t('settings.savePersonalization')}
        </Button>
      </div>
    </SettingsSection>
  );

  if (embedded) {
    return block;
  }

  return (
    <section className="settings-page settings-page-personalization">
      {block}
    </section>
  );
};
