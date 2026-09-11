import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentShellSettings, CodeInterpreterSettings, RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';
import { CodeInterpreterSettingsFields } from './CodeInterpreterSettingsFields';
import { ShellSettingsFields } from './ShellSettingsFields';
import { LocalToolDisclosure } from './LocalToolDisclosure';
import { Button } from '../../../../ui/Button';

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
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(t('settings.saving'));
    try {
      await onSaveToolsConfig();
      setStatus(t('settings.toolsSaved'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-tools-card-stack" onChange={() => setStatus('')} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('settings.localToolsTitle')}</div>
          <div className="settings-section-subtitle">{t('settings.localToolsHint')}</div>
        </div>
      </header>

      <LocalToolDisclosure
        icon="nav-tools"
        title={t('settings.rdxToolchainTitle')}
        description={t('settings.rdxToolchainHint')}
        testId="settings-rdx-block"
      >
        <RdxCliInvokerSettingsFields
          rdxCliDraft={rdxCliDraft}
          rdxActionsDraft={rdxActionsDraft}
          onRdxCliDraftChange={onRdxCliDraftChange}
          onRdxActionsDraftChange={onRdxActionsDraftChange}
          t={t}
        />
      </LocalToolDisclosure>

      <LocalToolDisclosure
        icon="nav-hooks"
        title={t('settings.shellTitle')}
        description={t('settings.shellHint')}
        testId="settings-shell-block"
      >
        <ShellSettingsFields draft={shellDraft} onChange={onShellDraftChange} t={t} />
      </LocalToolDisclosure>

      <LocalToolDisclosure
        icon="nav-skills"
        title={t('settings.codeInterpreterTitle')}
        description={t('settings.codeInterpreterHint')}
        testId="settings-code-interpreter-block"
      >
        <CodeInterpreterSettingsFields
          draft={codeInterpreterDraft}
          onChange={onCodeInterpreterDraftChange}
          t={t}
        />
      </LocalToolDisclosure>

      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status" role="status">{status}</span>
        <Button type="submit" variant="primary" disabled={saving}>{t('settings.saveTools')}</Button>
      </div>
    </form>
  );
};
