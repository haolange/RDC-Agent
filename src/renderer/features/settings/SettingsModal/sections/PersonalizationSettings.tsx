import React, { useState } from 'react';
import type { useI18n } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';

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
      <div className="settings-browser-block settings-personalization-block">
        <div className="settings-browser-section-head">
          <div>
            <div className="settings-browser-section-title">{t('settings.globalInstructions')}</div>
            <div className="settings-help-text">{t('settings.globalInstructionsHint')}</div>
          </div>
        </div>
        <AutosizeTextarea
          maxHeight={360}
          className="input settings-agent-instructions settings-personalization-textarea"
          value={globalInstructionsDraft}
          onChange={(event) => onGlobalInstructionsDraftChange(event.currentTarget.value)}
          placeholder={t('settings.globalInstructionsPlaceholder')}
        />
        <div className="settings-actions settings-actions-split">
          <span className="settings-save-status">{status}</span>
          <button type="button" className="button button-primary" onClick={() => void save()}>
            {t('settings.savePersonalization')}
          </button>
        </div>
      </div>
  );

  if (embedded) {
    return block;
  }

  return (
    <section className="settings-page settings-page-personalization">
      <div className="settings-browser-page-head">
        <h2>{t('settings.personalization')}</h2>
      </div>
      {block}
    </section>
  );
};
