import { useState, type Dispatch, type SetStateAction } from 'react';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { envToText, textToEnv } from './toolEnvText';
import { useRdcInstallation } from './useRdcInstallation';

interface Props {
  rdcCliDraft: RdcCliInvokerSettings;
  onRdcCliDraftChange: Dispatch<SetStateAction<RdcCliInvokerSettings>>;
  t: ReturnType<typeof useI18n>['t'];
}

export function RdcCliInvokerSettingsFields({ rdcCliDraft: draft, onRdcCliDraftChange: change, t }: Props) {
  const installation = useRdcInstallation(draft, change);
  const [envText, setEnvText] = useState(() => envToText(draft.env));
  const patch = (value: Partial<RdcCliInvokerSettings>) => { installation.invalidate(); change({ ...draft, ...value }); };
  return <section className="settings-local-tool-form settings-renderdoc-toolchain" data-testid="settings-rdc-toolchain">
    <p className="settings-help-text">{t('settings.rdcFolderHint')}</p>
    <SettingsField label={t('settings.rdcFolder')} htmlFor="settings-rdc-installation-root">
      <Input id="settings-rdc-installation-root" readOnly value={installation.root || draft.command}
        title={installation.root || draft.command} placeholder={t('settings.rdcNotSelected')} />
    </SettingsField>
    <div className="settings-actions">
      <Button size="sm" disabled={installation.busy} onClick={() => void installation.detect()}>{t('settings.rdcDetect')}</Button>
      <Button size="sm" disabled={installation.busy} onClick={() => void installation.select()}>{t('settings.rdcSelect')}</Button>
      <Button size="sm" variant="primary" disabled={installation.busy || !installation.root} onClick={() => void installation.apply()}>
        {t(installation.busy ? 'settings.rdcVerifying' : 'settings.rdcApply')}
      </Button>
    </div>
    {installation.candidates.map((candidate) => <div key={candidate.root}>
      <Button size="sm" disabled={installation.busy || !!candidate.problem} onClick={() => void installation.choose(candidate.root)}>{candidate.root}</Button>
      {candidate.problem && <p className="settings-help-text">{candidate.problem}</p>}
    </div>)}
    <p className="settings-help-text" role="status" aria-live="polite">
      {installation.error || (installation.summary
        ? `${t('settings.rdcApplied')}: ${installation.summary.runtime.version} · ${installation.summary.runtime.catalog.toolCount} ${t('settings.rdcOperations')}`
        : installation.detected && !installation.candidates.length ? t('settings.rdcNotFound') : t('settings.rdcVerifyHint'))}
    </p>
    <details>
      <summary>{t('settings.rdcAdvanced')}</summary>
      <label className="settings-switch-row">
        <span>{t('settings.rdcCliEnabled')}</span>
        <Switch checked={draft.enabled} disabled={installation.busy} onCheckedChange={(enabled) => patch({ enabled })}
          aria-label={t('settings.rdcCliEnabled')} data-testid="settings-rdc-enabled" />
      </label>
      <SettingsField label={t('settings.rdcCliTimeoutMs')} htmlFor="settings-rdc-timeout" layout="row">
        <Input id="settings-rdc-timeout" type="number" min={1000} max={600000} step={1000} disabled={installation.busy} value={draft.timeoutMs}
          onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })} />
      </SettingsField>
      <SettingsField label={t('settings.rdcCliEnv')} htmlFor="settings-rdc-environment" description={t('settings.rdcCliEnvHint')}>
        <Textarea id="settings-rdc-environment" className="settings-rdc-cli-textarea" disabled={installation.busy}
          value={envText} placeholder="NAME=value" spellCheck={false}
          onChange={(event) => { setEnvText(event.currentTarget.value); patch({ env: textToEnv(event.currentTarget.value) }); }} />
      </SettingsField>
    </details>
  </section>;
}
