import React, { useEffect, useState } from 'react';
import type { AgentShellSettings, ResolvedShellSnapshot } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { selectFiles } from '../../../../hooks/appShellBridge';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { InlineError } from '../../../../ui/InlineError';
import { SettingsField } from '../parts';
import { getResolvedShell } from './shellSettingsActions';

type Translate = ReturnType<typeof useI18n>['t'];

interface ShellSettingsFieldsProps {
  draft: AgentShellSettings;
  onChange: (next: AgentShellSettings) => void;
  t: Translate;
}

/**
 * Agent Shell (machine-local): executable override with a real file picker, plus the
 * read-only detection result from main. Nothing here claims a shell is installed.
 */
export const ShellSettingsFields: React.FC<ShellSettingsFieldsProps> = ({ draft, onChange, t }) => {
  const [resolved, setResolved] = useState<ResolvedShellSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void getResolvedShell(draft.executable)
        ?.then((snapshot) => {
          if (!cancelled) setResolved(snapshot ?? null);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResolved({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [draft.executable]);

  const browse = async () => {
    const paths = await selectFiles();
    const next = paths?.[0];
    if (next) onChange({ ...draft, executable: next });
  };

  return (
    <section className="settings-local-tool-form" data-testid="settings-agent-shell" data-settings-search="agent-shell">
      <header className="settings-local-tool-form-head">
        <div>
          <p className="settings-help-text">{t('settings.shellHint')}</p>
        </div>
      </header>

      <div className="settings-local-tool-grid">
        <SettingsField label={t('settings.shellExecutable')} layout="row">
          <div className="settings-input-with-action">
            <Input
              type="text"
              data-testid="settings-agent-shell-executable"
              value={draft.executable}
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, executable: event.target.value })}
              placeholder="C:\Program Files\PowerShell\7\pwsh.exe"
            />
            <Button variant="secondary" size="md" onClick={() => void browse()} data-testid="settings-agent-shell-browse">
              {t('settings.browse')}
            </Button>
          </div>
        </SettingsField>

        <SettingsField label={t('settings.shellDetected')} layout="row">
          <div className="settings-readonly-status" data-testid="settings-agent-shell-diagnostics">
            {resolved?.ok ? (
              <>
                <strong>
                  {resolved.label}
                  {resolved.version ? ` ${resolved.version}` : ''}
                </strong>
                <code>{resolved.executable}</code>
              </>
            ) : resolved ? (
              <InlineError data-testid="settings-agent-shell-error">{resolved.error}</InlineError>
            ) : (
              <span className="settings-help-text">{t('settings.shellDetecting')}</span>
            )}
          </div>
        </SettingsField>
      </div>

      {resolved?.ok && resolved.kind === 'windows-powershell' ? (
        <p className="settings-help-text settings-runtime-editor-note" data-testid="settings-agent-shell-upgrade">
          {t('settings.shellUpgradePwsh')}
        </p>
      ) : null}
    </section>
  );
};
