import { useState, type Dispatch, type SetStateAction } from 'react';
import { RDC_NO_PROGRESS_TIMEOUT_RANGE_MS } from '@shared/constants/appSettingsDefaults';
import { Button } from '../../../../ui/Button';
import { Details } from '../../../../ui/Details';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { envToText, textToEnv } from './toolEnvText';
import type { useRdcInstallation } from './useRdcInstallation';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

interface Props {
  installation: ReturnType<typeof useRdcInstallation>;
  rdcCliDraft: RdcCliInvokerSettings;
  onRdcCliDraftChange: Dispatch<SetStateAction<RdcCliInvokerSettings>>;
}

export function RdcCliInvokerSettingsFields({ rdcCliDraft: draft, onRdcCliDraftChange: change, installation }: Props) {
  const { t } = useI18n();
  const [envText, setEnvText] = useState(() => envToText(draft.env));
  const patch = (value: Partial<RdcCliInvokerSettings>) => {
    installation.invalidate();
    change({ ...draft, ...value });
  };
  return (
    <section className="settings-local-tool-form settings-renderdoc-toolchain" data-testid="settings-rdc-toolchain">
      <SettingsField
        label={t('settings.rdcFolder')}
        htmlFor="settings-rdc-installation-root"
        description={t('settings.rdcFolderHint')}
      >
        <div className="settings-rdc-location">
          <Input
            id="settings-rdc-installation-root"
            readOnly
            value={installation.root || draft.command}
            data-tooltip={installation.root || draft.command}
            placeholder={t('settings.rdcNotSelected')}
          />
          <Button size="sm" disabled={installation.busy} onClick={() => void installation.select()}>
            {t('settings.rdcSelect')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={installation.operation === 'detect'}
            disabled={installation.busy}
            onClick={() => void installation.detect()}
          >
            {t('settings.rdcDetect')}
          </Button>
        </div>
      </SettingsField>
      {installation.candidates.length > 0 ? (
        <div className="settings-rdc-candidates">
          {installation.candidates.map((candidate) => (
            <Button
              key={candidate.root}
              size="sm"
              variant="ghost"
              disabled={installation.busy || !!candidate.problem}
              data-tooltip={candidate.problem || candidate.root}
              onClick={() => void installation.choose(candidate.root)}
            >
              {candidate.root}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="settings-rdc-apply">
        <Button
          size="sm"
          variant="primary"
          loading={installation.operation === 'apply'}
          disabled={installation.busy || !installation.root}
          onClick={() => void installation.apply()}
        >
          {t(installation.operation === 'apply' ? 'settings.rdcVerifying' : 'settings.rdcApply')}
        </Button>
        {installation.error ? (
          <InlineError detail={installation.error}>{t('settings.rdcApplyFailed')}</InlineError>
        ) : installation.summary ? (
          <p className="settings-rdc-status" role="status">
            <Icon name="check" size={14} />
            {t('settings.rdcAppliedSummary', {
              version: installation.summary.runtime.version ?? '',
              count: installation.summary.runtime.catalog.toolCount ?? 0,
            })}
          </p>
        ) : installation.detected && !installation.candidates.length ? (
          <p className="settings-rdc-status" role="status">
            {t('settings.rdcNotFound')}
          </p>
        ) : null}
      </div>
      <Details className="settings-rdc-advanced" summary={t('settings.rdcAdvanced')}>
        <div className="settings-local-tool-grid">
          <SettingsField layout="row" label={t('settings.rdcCliEnabled')} htmlFor="settings-rdc-enabled">
            <Switch
              checked={draft.enabled}
              disabled={installation.busy}
              onCheckedChange={(enabled) => patch({ enabled })}
              id="settings-rdc-enabled"
              data-testid="settings-rdc-enabled"
            />
          </SettingsField>
          <SettingsField
            label={t('settings.rdcNoProgressTimeout')}
            htmlFor="settings-rdc-no-progress-timeout"
            description={t('settings.rdcNoProgressTimeoutHint')}
            layout="row"
          >
            {/* Stored in milliseconds, edited in seconds within the range RDC-Tool accepts. */}
            <Input
              id="settings-rdc-no-progress-timeout"
              type="number"
              min={RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.min / 1000}
              max={RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.max / 1000}
              step={1}
              disabled={installation.busy}
              value={draft.noProgressTimeoutMs / 1000}
              onChange={(event) => patch({ noProgressTimeoutMs: Math.round(Number(event.currentTarget.value) * 1000) })}
            />
          </SettingsField>
          <SettingsField
            label={t('settings.rdcCliEnv')}
            htmlFor="settings-rdc-environment"
            description={t('settings.rdcCliEnvHint')}
          >
            <Textarea
              id="settings-rdc-environment"
              disabled={installation.busy}
              value={envText}
              placeholder="NAME=value"
              spellCheck={false}
              onChange={(event) => {
                setEnvText(event.currentTarget.value);
                patch({ env: textToEnv(event.currentTarget.value) });
              }}
            />
          </SettingsField>
        </div>
      </Details>
    </section>
  );
}
