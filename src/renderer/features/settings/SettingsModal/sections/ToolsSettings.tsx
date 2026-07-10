import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';

type Translate = ReturnType<typeof useI18n>['t'];

interface ToolsSettingsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  rdxActionsDraft: RdxActionSettingsMap;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
  onSaveToolsConfig: () => void | Promise<void>;
  t: Translate;
}

export const ToolsSettings: React.FC<ToolsSettingsProps> = ({
  rdxCliDraft,
  rdxActionsDraft,
  onRdxCliDraftChange,
  onRdxActionsDraftChange,
  onSaveToolsConfig,
  t,
}) => {
  const [status, setStatus] = useState('');
  const save = async () => {
    setStatus(t('settings.saving'));
    await onSaveToolsConfig();
    setStatus(t('settings.toolsSaved'));
  };

  return (
    <section className="settings-page settings-page-tools">
      <div className="settings-browser-block settings-tool-card" data-testid="settings-rdx-block">
        <RdxCliInvokerSettingsFields
          rdxCliDraft={rdxCliDraft}
          rdxActionsDraft={rdxActionsDraft}
          onRdxCliDraftChange={onRdxCliDraftChange}
          onRdxActionsDraftChange={onRdxActionsDraftChange}
          t={t}
        />
      </div>
      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status">{status}</span>
        <button type="button" className="button button-primary" onClick={() => void save()}>{t('settings.saveTools')}</button>
      </div>
    </section>
  );
};
