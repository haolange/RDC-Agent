import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentShellSettings, CodeInterpreterSettings, RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';
import { CodeInterpreterSettingsFields } from './CodeInterpreterSettingsFields';
import { ShellSettingsFields } from './ShellSettingsFields';

type Translate = ReturnType<typeof useI18n>['t'];

interface ToolsSettingsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  rdxActionsDraft: RdxActionSettingsMap;
  codeInterpreterDraft: CodeInterpreterSettings;
  shellDraft: AgentShellSettings;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
  onCodeInterpreterDraftChange: Dispatch<SetStateAction<CodeInterpreterSettings>>;
  onShellDraftChange: Dispatch<SetStateAction<AgentShellSettings>>;
  onSaveToolsConfig: () => void | Promise<void>;
  t: Translate;
}

export const ToolsSettings: React.FC<ToolsSettingsProps> = ({
  rdxCliDraft,
  rdxActionsDraft,
  codeInterpreterDraft,
  shellDraft,
  onRdxCliDraftChange,
  onRdxActionsDraftChange,
  onCodeInterpreterDraftChange,
  onShellDraftChange,
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
    <>
      <div className="settings-browser-block settings-tool-card" data-testid="settings-rdx-block">
        <RdxCliInvokerSettingsFields
          rdxCliDraft={rdxCliDraft}
          rdxActionsDraft={rdxActionsDraft}
          onRdxCliDraftChange={onRdxCliDraftChange}
          onRdxActionsDraftChange={onRdxActionsDraftChange}
          t={t}
        />
      </div>
      <ShellSettingsFields
        draft={shellDraft}
        onChange={onShellDraftChange}
        t={t}
      />
      <CodeInterpreterSettingsFields
        draft={codeInterpreterDraft}
        onChange={onCodeInterpreterDraftChange}
        t={t}
      />
      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status">{status}</span>
        <button type="button" className="button button-primary" onClick={() => void save()}>{t('settings.saveTools')}</button>
      </div>
    </>
  );
};
