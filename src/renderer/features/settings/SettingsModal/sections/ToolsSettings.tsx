import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentShellSettings, CodeInterpreterSettings, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';
import { CodeInterpreterSettingsFields } from './CodeInterpreterSettingsFields';
import { ShellSettingsFields } from './ShellSettingsFields';
import { LocalToolDisclosure } from './LocalToolDisclosure';
import { Button } from '../../../../ui/Button';

type Translate = ReturnType<typeof useI18n>['t'];
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ToolsSettingsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  codeInterpreterDraft: CodeInterpreterSettings;
  shellDraft: AgentShellSettings;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onCodeInterpreterDraftChange: Dispatch<SetStateAction<CodeInterpreterSettings>>;
  onShellDraftChange: Dispatch<SetStateAction<AgentShellSettings>>;
  onSaveToolsConfig: () => void | Promise<void>;
  /** True while the drafts differ from the persisted Tools settings. */
  dirty: boolean;
  t: Translate;
}

export const ToolsSettings: React.FC<ToolsSettingsProps> = ({
  rdxCliDraft,
  codeInterpreterDraft,
  shellDraft,
  onRdxCliDraftChange,
  onCodeInterpreterDraftChange,
  onShellDraftChange,
  onSaveToolsConfig,
  dirty,
  t,
}) => {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');
  const saving = status === 'saving';

  const save = async () => {
    if (saving) return;
    setStatus('saving');
    setError('');
    try {
      await onSaveToolsConfig();
      setStatus('saved');
    } catch (failure) {
      setStatus('error');
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const statusText = status === 'saving'
    ? t('settings.saving')
    : status === 'error'
      ? error
      : dirty
        ? t('settings.unsaved')
        : status === 'saved'
          ? t('settings.toolsSaved')
          : '';

  return (
    <form
      className="settings-tools-card-stack"
      data-testid="settings-local-tools"
      onChange={() => { if (status !== 'saving') setStatus('idle'); }}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <header className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('settings.localToolsTitle')}</div>
          <div className="settings-section-subtitle">{t('settings.localToolsHint')}</div>
        </div>
      </header>

      <LocalToolDisclosure
        icon="cube"
        title={t('settings.rdxToolchainTitle')}
        description={t('settings.rdxToolchainHint')}
        testId="settings-rdx-block"
      >
        <RdxCliInvokerSettingsFields rdxCliDraft={rdxCliDraft} onRdxCliDraftChange={onRdxCliDraftChange} t={t} />
      </LocalToolDisclosure>

      <LocalToolDisclosure
        icon="terminal"
        title={t('settings.shellTitle')}
        description={t('settings.shellSummary')}
        testId="settings-shell-block"
      >
        <ShellSettingsFields draft={shellDraft} onChange={onShellDraftChange} t={t} />
      </LocalToolDisclosure>

      <LocalToolDisclosure
        icon="code"
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

      <div className="settings-actions settings-actions-split settings-tools-save-bar">
        <span
          className="settings-save-status"
          role="status"
          data-status={status === 'idle' && dirty ? 'dirty' : status}
          data-testid="settings-tools-save-status"
        >
          {statusText}
        </span>
        <Button type="submit" variant="primary" disabled={saving || !dirty} data-testid="settings-tools-save">
          {t('settings.save')}
        </Button>
      </div>
    </form>
  );
};
