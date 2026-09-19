import React, { useState, useRef, type Dispatch, type SetStateAction } from 'react';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import type { ToolRuntimeSummary } from '@shared/types/tool';
import { validateRdxInstallation } from '../../../../platform/rdxInstallation';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { envToText, textToEnv } from './toolEnvText';

type Translate = ReturnType<typeof useI18n>['t'];

interface RdxCliInvokerSettingsFieldsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  t: Translate;
}

/**
 * Local RenderDoc CLI toolchain (machine-local). Every field is visible when the
 * disclosure is open; the enable switch sits in the section head.
 */
export const RdxCliInvokerSettingsFields: React.FC<RdxCliInvokerSettingsFieldsProps> = ({
  rdxCliDraft,
  onRdxCliDraftChange,
  t,
}) => {
  const validationRevision = useRef(0);
  const [checking, setChecking] = useState(false);
  const [summary, setSummary] = useState<ToolRuntimeSummary | null>(null);
  const [message, setMessage] = useState('');
  const [envText, setEnvText] = useState(() => envToText(rdxCliDraft.env));
  const [argsText, setArgsText] = useState(() => rdxCliDraft.argsPrefix.join(' '));
  const validate = async () => {
    const revision = ++validationRevision.current;
    setChecking(true); setSummary(null); setMessage('');
    try {
      const result = await validateRdxInstallation(rdxCliDraft);
      if (revision !== validationRevision.current) return;
      if (result) setSummary(result); else setMessage(t('settings.rdxSaveBeforeVerify'));
    } catch (error) { if (revision === validationRevision.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  };
  const patch = (next: Partial<RdxCliInvokerSettings>) => {
    validationRevision.current += 1;
    setSummary(null); setMessage('');
    onRdxCliDraftChange((current) => ({ ...current, ...next }));
  };

  return (
    <section className="settings-local-tool-form settings-renderdoc-toolchain" data-testid="settings-rdx-toolchain">
      <header className="settings-local-tool-form-head">
        <div>
          <p className="settings-help-text">{t('settings.localRenderDocToolchainHint')}</p>
        </div>
        <label className="settings-switch-row">
          <span>{rdxCliDraft.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
          <Switch
            checked={rdxCliDraft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label={t('settings.rdxCliEnabled')}
            data-testid="settings-rdx-enabled"
          />
        </label>
      </header>

      <div className="settings-local-tool-form-head">
        <Button size="sm" disabled={checking || !rdxCliDraft.enabled || !rdxCliDraft.command.trim()} onClick={() => void validate()}>
          {checking ? t('settings.rdxVerifying') : t('settings.rdxVerify')}
        </Button>
        <p className="settings-help-text" role="status" aria-live="polite">
          {message || (summary ? (summary.cli.available
            ? `${t('settings.rdxVerified')}: ${summary.runtime.version} · ${summary.runtime.catalog.toolCount} ${t('settings.rdxOperations')} · ${t('settings.rdxCliIntermediateRoot')}: ${summary.runtime.intermediateRoot}`
            : summary.cli.unavailableReason) : t('settings.rdxVerifyHint'))}
        </p>
      </div>
      <div className="settings-local-tool-grid">
        <SettingsField label={t('settings.rdxCliCommand')} layout="row">
          <Input
            value={rdxCliDraft.command}
            placeholder="C:\\Tools\\rdx\\binaries\\windows\\x64\\python\\python.exe"
            spellCheck={false}
            onChange={(event) => patch({ command: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliArgsPrefix')} layout="row" description={t('settings.rdxCliArgsPrefixHint')}>
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
        <SettingsField label={t('settings.rdxCliWorkingDirectory')} layout="row">
          <Input
            value={rdxCliDraft.workingDirectory}
            placeholder="C:\\Tools\\rdx"
            spellCheck={false}
            onChange={(event) => patch({ workingDirectory: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliTimeoutMs')} layout="row">
          <Input
            type="number"
            min={1000}
            max={600000}
            step={1000}
            value={rdxCliDraft.timeoutMs}
            onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliEnv')} layout="row" description={t('settings.rdxCliEnvHint')}>
          <AutosizeTextarea
            maxHeight={180}
            className="input settings-rdx-cli-textarea"
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
