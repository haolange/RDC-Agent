import React, { useState, useRef, type Dispatch, type SetStateAction } from 'react';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ToolRuntimeSummary } from '@shared/types/tool';
import { validateRdcInstallation } from '../../../../platform/rdcInstallation';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { envToText, textToEnv } from './toolEnvText';

type Translate = ReturnType<typeof useI18n>['t'];

interface RdcCliInvokerSettingsFieldsProps {
  rdcCliDraft: RdcCliInvokerSettings;
  onRdcCliDraftChange: Dispatch<SetStateAction<RdcCliInvokerSettings>>;
  t: Translate;
}

/**
 * Local RDC-Tool toolchain (machine-local). Every field is visible when the
 * disclosure is open; the enable switch sits in the section head.
 */
export const RdcCliInvokerSettingsFields: React.FC<RdcCliInvokerSettingsFieldsProps> = ({
  rdcCliDraft,
  onRdcCliDraftChange,
  t,
}) => {
  const validationRevision = useRef(0);
  const [checking, setChecking] = useState(false);
  const [summary, setSummary] = useState<ToolRuntimeSummary | null>(null);
  const [message, setMessage] = useState('');
  const [envText, setEnvText] = useState(() => envToText(rdcCliDraft.env));
  const [argsText, setArgsText] = useState(() => rdcCliDraft.argsPrefix.join(' '));
  const validate = async () => {
    const revision = ++validationRevision.current;
    setChecking(true); setSummary(null); setMessage('');
    try {
      const result = await validateRdcInstallation(rdcCliDraft);
      if (revision !== validationRevision.current) return;
      if (result) setSummary(result); else setMessage(t('settings.rdcSaveBeforeVerify'));
    } catch (error) { if (revision === validationRevision.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  };
  const patch = (next: Partial<RdcCliInvokerSettings>) => {
    validationRevision.current += 1;
    setSummary(null); setMessage('');
    onRdcCliDraftChange((current) => ({ ...current, ...next }));
  };

  return (
    <section className="settings-local-tool-form settings-renderdoc-toolchain" data-testid="settings-rdc-toolchain">
      <header className="settings-local-tool-form-head">
        <div>
          <p className="settings-help-text">{t('settings.localRenderDocToolchainHint')}</p>
        </div>
        <label className="settings-switch-row">
          <span>{rdcCliDraft.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
          <Switch
            checked={rdcCliDraft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label={t('settings.rdcCliEnabled')}
            data-testid="settings-rdc-enabled"
          />
        </label>
      </header>

      <div className="settings-local-tool-form-head">
        <Button size="sm" disabled={checking || !rdcCliDraft.enabled || !rdcCliDraft.command.trim()} onClick={() => void validate()}>
          {checking ? t('settings.rdcVerifying') : t('settings.rdcVerify')}
        </Button>
        <p className="settings-help-text" role="status" aria-live="polite">
          {message || (summary ? (summary.cli.available
            ? `${t('settings.rdcVerified')}: ${summary.runtime.version} · ${summary.runtime.catalog.toolCount} ${t('settings.rdcOperations')} · ${t('settings.rdcCliIntermediateRoot')}: ${summary.runtime.intermediateRoot}`
            : summary.cli.unavailableReason) : t('settings.rdcVerifyHint'))}
        </p>
      </div>
      <div className="settings-local-tool-grid">
        <SettingsField label={t('settings.rdcCliCommand')} layout="row">
          <Input
            value={rdcCliDraft.command}
            placeholder="C:\\Tools\\rdc\\binaries\\windows\\x64\\python\\python.exe"
            spellCheck={false}
            onChange={(event) => patch({ command: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdcCliArgsPrefix')} layout="row" description={t('settings.rdcCliArgsPrefixHint')}>
          <Input
            value={argsText}
            placeholder="cli/run_cli.py"
            spellCheck={false}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setArgsText(value);
              patch({ argsPrefix: [value.trim().replace(/^"|"$/g, "")].filter(Boolean) });
            }}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdcCliWorkingDirectory')} layout="row">
          <Input
            value={rdcCliDraft.workingDirectory}
            placeholder="C:\\Tools\\rdc"
            spellCheck={false}
            onChange={(event) => patch({ workingDirectory: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdcCliTimeoutMs')} layout="row">
          <Input
            type="number"
            min={1000}
            max={600000}
            step={1000}
            value={rdcCliDraft.timeoutMs}
            onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdcCliEnv')} layout="row" description={t('settings.rdcCliEnvHint')}>
          <AutosizeTextarea
            maxHeight={180}
            className="input settings-rdc-cli-textarea"
            value={envText}
            placeholder="NAME=value"
            spellCheck={false}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setEnvText(value);
              patch({ env: textToEnv(value) });
            }}
          />
        </SettingsField>
      </div>
    </section>
  );
};
