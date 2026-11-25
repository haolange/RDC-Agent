import React, { useState, type Dispatch, type SetStateAction } from 'react';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { errorDetail } from '../../../../lib/errorDetail';
import { useI18n } from '../../../../i18n';
import { RdcCliInvokerSettingsFields } from './RdcCliInvokerSettingsFields';
import { CodeInterpreterSettingsFields } from './CodeInterpreterSettingsFields';
import { ShellSettingsFields } from './ShellSettingsFields';
import { LocalToolDisclosure } from './LocalToolDisclosure';
import { useRdcInstallation } from './useRdcInstallation';
import type { AgentShellSettings, CodeInterpreterSettings, RdcCliInvokerSettings } from '@shared/types/settings';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ToolsSettingsProps {
  rdcCliDraft: RdcCliInvokerSettings;
  codeInterpreterDraft: CodeInterpreterSettings;
  shellDraft: AgentShellSettings;
  onRdcCliDraftChange: Dispatch<SetStateAction<RdcCliInvokerSettings>>;
  onCodeInterpreterDraftChange: Dispatch<SetStateAction<CodeInterpreterSettings>>;
  onShellDraftChange: Dispatch<SetStateAction<AgentShellSettings>>;
  onSaveToolsConfig: () => void | Promise<void>;
  /** True while the drafts differ from the persisted Tools settings. */
  dirty: boolean;
}

export const ToolsSettings: React.FC<ToolsSettingsProps> = ({
  rdcCliDraft,
  codeInterpreterDraft,
  shellDraft,
  onRdcCliDraftChange,
  onCodeInterpreterDraftChange,
  onShellDraftChange,
  onSaveToolsConfig,
  dirty,
}) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');
  const saving = status === 'saving';
  const installation = useRdcInstallation(rdcCliDraft, onRdcCliDraftChange);

  const save = async () => {
    if (saving || installation.busy || !dirty) return;
    setStatus('saving');
    setError('');
    try {
      await onSaveToolsConfig();
      setStatus('saved');
    } catch (failure) {
      setStatus('error');
      setError(errorDetail(failure));
    }
  };

  const statusText = status === 'saving'
    ? t('settings.saving')
    : status === 'error'
      ? ''
      : dirty
        ? t('settings.unsaved')
        : status === 'saved'
          ? t('settings.toolsSaved')
          : '';

  return (
    <form
      className="settings-tools-card-stack"
      data-testid="settings-local-tools"
      onChange={() => { if (!saving) { setStatus('idle'); setError(''); } }}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <header className="settings-section-header">
        <div className="settings-section-title">{t('settings.localToolsTitle')}</div>
        <p className="settings-section-description">{t('settings.localToolsHint')}</p>
      </header>

      <fieldset disabled={saving} className="settings-local-tool-fields" aria-label={t('settings.localToolsTitle')}>
        <LocalToolDisclosure
          icon="cube"
          title={t('settings.rdcToolchainTitle')}
          description={t('settings.rdcToolchainHint')}
          status={t(rdcCliDraft.enabled ? 'settings.localToolEnabled' : 'settings.disabled')}
          testId="settings-rdc-block"
        >
          <RdcCliInvokerSettingsFields rdcCliDraft={rdcCliDraft} onRdcCliDraftChange={onRdcCliDraftChange} installation={installation} />
        </LocalToolDisclosure>

        <LocalToolDisclosure
          icon="terminal"
          title={t('settings.shellTitle')}
          description={t('settings.shellSummary')}
          status={t(shellDraft.executable.trim() ? 'settings.localToolCustom' : 'settings.localToolAutomatic')}
          testId="settings-shell-block"
        >
          <ShellSettingsFields draft={shellDraft} onChange={onShellDraftChange} />
        </LocalToolDisclosure>

        <LocalToolDisclosure
          icon="code"
          title={t('settings.codeInterpreterTitle')}
          description={t('settings.codeInterpreterHint')}
          status={t(codeInterpreterDraft.enabled ? 'settings.localToolEnabled' : 'settings.disabled')}
          testId="settings-code-interpreter-block"
        >
          <CodeInterpreterSettingsFields draft={codeInterpreterDraft} onChange={onCodeInterpreterDraftChange} />
        </LocalToolDisclosure>
      </fieldset>

      {error ? <InlineError detail={error}>{t('settings.localToolsSaveFailed')}</InlineError> : null}
      {statusText || error ? <div className="settings-actions settings-actions-split settings-tools-save-bar">
        <span
          className="settings-save-status"
          role="status"
          data-status={status === 'idle' && dirty ? 'dirty' : status}
          data-testid="settings-tools-save-status"
        >
          {statusText}
        </span>
        {dirty || saving ? <Button type="submit" variant="primary" disabled={saving || installation.busy} data-testid="settings-tools-save">
          {t('settings.save')}
        </Button> : null}
      </div> : null}
    </form>
  );
};
