import { useState, type Dispatch, type SetStateAction } from 'react';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { envToText, textToEnv } from './toolEnvText';
import { useRdcInstallation } from './useRdcInstallation';
import type { useI18n } from '../../../../i18n';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

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
    <SettingsField label={t('settings.rdcFolder')} htmlFor="settings-rdc-installation-root" description={t('settings.rdcFolderHint')}>
      <Input id="settings-rdc-installation-root" readOnly value={installation.root || draft.command}
        data-tooltip={installation.root || draft.command} placeholder={t('settings.rdcNotSelected')} />
    </SettingsField>
    <div className="settings-actions">
      <Button size="sm" disabled={installation.busy} onClick={() => void installation.detect()}>{t('settings.rdcDetect')}</Button>
      <Button size="sm" disabled={installation.busy} onClick={() => void installation.select()}>{t('settings.rdcSelect')}</Button>
      <Button size="sm" variant="primary" disabled={installation.busy || !installation.root} onClick={() => void installation.apply()}>
        {t(installation.busy ? 'settings.rdcVerifying' : 'settings.rdcApply')}
      </Button>
    </div>
    {installation.candidates.length > 0 ? (
      <div className="settings-rdc-candidates">
        {installation.candidates.map((candidate) => (
          <Button key={candidate.root} size="sm" variant="ghost" disabled={installation.busy || !!candidate.problem}
            data-tooltip={candidate.problem || candidate.root} onClick={() => void installation.choose(candidate.root)}>
            {candidate.root}
          </Button>
        ))}
      </div>
    ) : null}
    {installation.error ? (
      <InlineError detail={installation.error}>{t('settings.rdcApplyFailed')}</InlineError>
    ) : installation.summary ? (
      <p className="settings-rdc-status" role="status" aria-live="polite">
        <Icon name="check" size={14} />
        {t('settings.rdcAppliedSummary', {
          version: installation.summary.runtime.version ?? '',
          count: installation.summary.runtime.catalog.toolCount ?? 0,
        })}
      </p>
    ) : installation.detected && !installation.candidates.length ? (
      <p className="settings-rdc-status" role="status" aria-live="polite">{t('settings.rdcNotFound')}</p>
    ) : null}
    <Details summary={t('settings.rdcAdvanced')}>
      <div className="settings-local-tool-grid">
      <label className="settings-switch-row">
        <span>{t('settings.rdcCliEnabled')}</span>
        <Switch checked={draft.enabled} disabled={installation.busy} onCheckedChange={(enabled) => patch({ enabled })}
          aria-label={t('settings.rdcCliEnabled')} data-testid="settings-rdc-enabled" />
      </label>
      <SettingsField label={t('settings.rdcCliTimeout')} htmlFor="settings-rdc-timeout" layout="row">
        {/* Stored in milliseconds, edited in seconds. */}
        <Input id="settings-rdc-timeout" type="number" min={1} max={600} step={1} disabled={installation.busy} value={draft.timeoutMs / 1000}
          onChange={(event) => patch({ timeoutMs: Math.round(Number(event.currentTarget.value) * 1000) })} />
      </SettingsField>
      <SettingsField label={t('settings.rdcCliEnv')} htmlFor="settings-rdc-environment" description={t('settings.rdcCliEnvHint')}>
        <Textarea id="settings-rdc-environment" className="settings-rdc-cli-textarea" disabled={installation.busy}
          value={envText} placeholder="NAME=value" spellCheck={false}
          onChange={(event) => { setEnvText(event.currentTarget.value); patch({ env: textToEnv(event.currentTarget.value) }); }} />
      </SettingsField>
      </div>
    </Details>
  </section>;
}
