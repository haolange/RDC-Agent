import React from 'react';
import type { CodeInterpreterSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/u)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;
    env[key] = line.slice(separatorIndex + 1);
  }
  return env;
}

type Translate = ReturnType<typeof useI18n>['t'];

interface CodeInterpreterSettingsFieldsProps {
  draft: CodeInterpreterSettings;
  onChange: (next: CodeInterpreterSettings) => void;
  t: Translate;
}

export const CodeInterpreterSettingsFields: React.FC<CodeInterpreterSettingsFieldsProps> = ({
  draft,
  onChange,
  t,
}) => (
  <div className="settings-browser-block settings-tool-card" data-testid="settings-code-interpreter">
    <h3>{t('settings.codeInterpreterTitle')}</h3>
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={draft.enabled}
        onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
      />
      {t('settings.codeInterpreterEnabled')}
    </label>
    <label>
      {t('settings.codeInterpreterCommand')}
      <input
        type="text"
        value={draft.command}
        onChange={(event) => onChange({ ...draft, command: event.target.value })}
        placeholder="python"
      />
    </label>
    <label>
      {t('settings.codeInterpreterArgs')}
      <input
        type="text"
        value={draft.argsPrefix.join(' ')}
        onChange={(event) => onChange({
          ...draft,
          argsPrefix: event.target.value.split(/\s+/u).filter(Boolean),
        })}
      />
    </label>
    <label>
      {t('settings.codeInterpreterTimeout')}
      <input
        type="number"
        min={1000}
        max={600000}
        value={draft.timeoutMs}
        onChange={(event) => onChange({ ...draft, timeoutMs: Number(event.target.value) || draft.timeoutMs })}
      />
    </label>
    <label>
      {t('settings.codeInterpreterEnv')}
      <AutosizeTextarea
        maxHeight={180}
        className="input"
        data-testid="settings-code-interpreter-env"
        value={Object.entries(draft.env).map(([key, value]) => `${key}=${value}`).join('\n')}
        placeholder="NAME=value"
        onChange={(event) => onChange({ ...draft, env: parseEnvText(event.target.value) })}
      />
    </label>
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={draft.artifactsEnabled}
        onChange={(event) => onChange({ ...draft, artifactsEnabled: event.target.checked })}
      />
      {t('settings.codeInterpreterArtifacts')}
    </label>
  </div>
);
