import React, { useState } from 'react';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField, SettingsSection } from '../parts';

type Translate = ReturnType<typeof useI18n>['t'];
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PersonalizationSettingsProps {
  globalInstructionsDraft: string;
  onGlobalInstructionsDraftChange: (value: string) => void;
  onSavePersonalization: () => void | Promise<void>;
  embedded?: boolean;
  t: Translate;
}

function statusText(status: SaveStatus, t: Translate): string {
  if (status === 'saving') return t('settings.saving');
  if (status === 'saved') return t('settings.personalizationSaved');
  if (status === 'error') return t('settings.personalizationSaveFailed');
  return '';
}

export const PersonalizationSettings: React.FC<PersonalizationSettingsProps> = ({
  globalInstructionsDraft,
  onGlobalInstructionsDraftChange,
  onSavePersonalization,
  embedded = false,
  t,
}) => {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const save = async () => {
    setStatus('saving');
    try {
      await onSavePersonalization();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const textareaId = 'settings-global-instructions';

  const block = (
    <SettingsSection
      className="settings-personalization-block"
      title={t('settings.personalizationTitle')}
      description={t('settings.personalizationHint')}
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
          onChange={(event) => {
            setStatus('idle');
            onGlobalInstructionsDraftChange(event.currentTarget.value);
          }}
          placeholder={t('settings.globalInstructionsPlaceholder')}
          rows={6}
        />
      </SettingsField>
      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status" role="status" data-status={status}>
          {statusText(status, t)}
        </span>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={status === 'saving'}>
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
