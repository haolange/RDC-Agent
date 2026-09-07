import React, { useEffect, useState } from 'react';
import type { AgentShellSettings, ResolvedShellSnapshot } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Input } from '../../../../ui/Input';
import { SettingsField, SettingsSection } from '../parts';
import { getResolvedShell } from './shellSettingsActions';

type Translate = ReturnType<typeof useI18n>['t'];

interface ShellSettingsFieldsProps {
  draft: AgentShellSettings;
  onChange: (next: AgentShellSettings) => void;
  t: Translate;
}

export const ShellSettingsFields: React.FC<ShellSettingsFieldsProps> = ({
  draft,
  onChange,
  t,
}) => {
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

  return (
    <SettingsSection
      className="settings-tool-card"
      data-testid="settings-agent-shell"
      data-settings-search="agent-shell"
      title={t('settings.shellTitle')}
      description={t('settings.shellHint')}
    >
      <SettingsField label={t('settings.shellExecutable')}>
        <Input
          type="text"
          data-testid="settings-agent-shell-executable"
          value={draft.executable}
          onChange={(event) => onChange({ ...draft, executable: event.target.value })}
          placeholder="C:\Program Files\PowerShell\7\pwsh.exe"
        />
      </SettingsField>
      <div className="settings-help-text" data-testid="settings-agent-shell-diagnostics">
        {resolved?.ok ? (
          <>
            <p>
              {t('settings.shellResolved')}
              {': '}
              {resolved.label}
              {resolved.version ? ` ${resolved.version}` : ''}
              {' · '}
              <code>{resolved.executable}</code>
            </p>
            {resolved.kind === 'windows-powershell' ? (
              <p data-testid="settings-agent-shell-upgrade">{t('settings.shellUpgradePwsh')}</p>
            ) : null}
          </>
        ) : resolved ? (
          <p data-testid="settings-agent-shell-error">{resolved.error}</p>
        ) : null}
      </div>
    </SettingsSection>
  );
};
