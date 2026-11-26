import React, { useEffect, useState } from 'react';
import { selectFiles } from '../../../../hooks/appShellBridge';
import { useElectronApi } from '../../../../hooks/useElectronApi';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { InlineError } from '../../../../ui/InlineError';
import { SettingsField } from '../parts';
import { errorDetail } from '../../../../lib/errorDetail';
import { abortableDelay, useAsyncValue } from '../../../../lib/useAsyncValue';
import { useI18n } from '../../../../i18n';
import { getResolvedShell } from './shellSettingsActions';
import type { AgentShellSettings, ResolvedShellSnapshot } from '@shared/types/settings';

interface ShellSettingsFieldsProps {
  draft: AgentShellSettings;
  onChange: (next: AgentShellSettings) => void;
}

/**
 * Agent Shell (machine-local): executable override with a real file picker, plus the
 * read-only detection result from main. Nothing here claims a shell is installed.
 */
/** An example path for the host the app actually runs on, never another platform's. */
const shellPlaceholder = (api: { isWindows: boolean; isMac: boolean } | undefined): string =>
  api?.isWindows ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : api?.isMac ? '/bin/zsh' : '/bin/bash';

export const ShellSettingsFields: React.FC<ShellSettingsFieldsProps> = ({ draft, onChange }) => {
  const { t } = useI18n();
  const api = useElectronApi();
  // The detection follows the executable after a pause in typing; the last result stays until the next one lands.
  const detection = useAsyncValue(draft.executable, async (signal) => {
    await abortableDelay(400, signal);
    return (await getResolvedShell(draft.executable)) ?? null;
  });
  const [resolved, setResolved] = useState<ResolvedShellSnapshot | null>(null);
  useEffect(() => {
    if (detection.status === 'ready') setResolved(detection.value);
    if (detection.status === 'error') setResolved({ ok: false, error: errorDetail(detection.error) });
  }, [detection]);

  const browse = async () => {
    const paths = await selectFiles();
    const next = paths?.[0];
    if (next) onChange({ ...draft, executable: next });
  };

  return (
    <section className="settings-local-tool-form" data-testid="settings-agent-shell" data-settings-search="agent-shell">
      <div className="settings-local-tool-grid">
        <SettingsField
          label={t('settings.shellExecutable')}
          htmlFor="settings-shell-executable"
          description={t('settings.shellHint')}
          warning={
            resolved?.ok && resolved.kind === 'windows-powershell' ? (
              <span data-testid="settings-agent-shell-upgrade">{t('settings.shellUpgradePwsh')}</span>
            ) : undefined
          }
        >
          <div className="settings-input-with-action">
            <Input
              type="text"
              id="settings-shell-executable"
              data-testid="settings-agent-shell-executable"
              value={draft.executable}
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, executable: event.target.value })}
              placeholder={shellPlaceholder(api)}
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => void browse()}
              data-testid="settings-agent-shell-browse"
            >
              {t('settings.browse')}
            </Button>
          </div>
        </SettingsField>

        <SettingsField label={t('settings.shellDetected')} layout="row">
          <div className="settings-readonly-status" data-testid="settings-agent-shell-diagnostics">
            {resolved?.ok ? (
              <>
                <strong tabIndex={0} data-tooltip={resolved.executable}>
                  {resolved.label}
                  {resolved.version ? ` ${resolved.version}` : ''}
                </strong>
              </>
            ) : resolved ? (
              <InlineError data-testid="settings-agent-shell-error" detail={resolved.error}>
                {t('settings.shellResolveFailed')}
              </InlineError>
            ) : (
              <span className="settings-readonly-status-pending">{t('settings.shellDetecting')}</span>
            )}
          </div>
        </SettingsField>
      </div>
    </section>
  );
};
