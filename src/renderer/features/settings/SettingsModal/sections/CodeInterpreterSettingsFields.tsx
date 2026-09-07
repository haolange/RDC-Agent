import React, { useState } from 'react';
import type { CodeInterpreterSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Input } from '../../../../ui/Input';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsSection } from '../parts';

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
}) => {
  const [envText, setEnvText] = useState(() => Object.entries(draft.env).map(([key, value]) => `${key}=${value}`).join('\n'));
  const [argsText, setArgsText] = useState(() => draft.argsPrefix.join(' '));
  const [timeoutText, setTimeoutText] = useState(() => String(draft.timeoutMs));
  return (
    <SettingsSection
      className="settings-tool-card"
      data-testid="settings-code-interpreter"
      data-settings-search="code-interpreter"
      title={t('settings.codeInterpreterTitle')}
    >
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
        />
        {t('settings.codeInterpreterEnabled')}
      </label>
      <div className="settings-interpreter-fields">
      <label className="settings-input-row">
        {t('settings.codeInterpreterCommand')}
        <Input
          type="text"
          value={draft.command}
          onChange={(event) => onChange({ ...draft, command: event.target.value })}
          placeholder="python"
        />
      </label>
      <label className="settings-input-row">
        {t('settings.codeInterpreterArgs')}
        <Input
          type="text"
          value={argsText}
          onChange={(event) => {
            setArgsText(event.target.value);
            onChange({ ...draft, argsPrefix: event.target.value.split(/\s+/u).filter(Boolean) });
          }}
        />
      </label>
      <label className="settings-input-row">
        {t('settings.codeInterpreterTimeout')}
        <Input
          type="number"
          min={1000}
          max={600000}
          required
          value={timeoutText}
          onChange={(event) => {
            setTimeoutText(event.target.value);
            onChange({ ...draft, timeoutMs: Number(event.target.value) });
          }}
        />
      </label>
      </div>
      <label className="settings-input-row">
        {t('settings.codeInterpreterEnv')}
        <AutosizeTextarea
          maxHeight={180}
          className="input"
          data-testid="settings-code-interpreter-env"
          value={envText}
          placeholder="NAME=value"
          onChange={(event) => {
            const value = event.target.value;
            setEnvText(value);
            onChange({ ...draft, env: parseEnvText(value) });
            event.target.setCustomValidity(value.split(/\r?\n/u).some((line) => line.trim() && (line.indexOf('=') <= 0 || !line.slice(0, line.indexOf('=')).trim()))
              ? t('settings.environmentFormatHint') : '');
          }}
        />
      </label>
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={draft.artifactsEnabled}
          onChange={(event) => onChange({ ...draft, artifactsEnabled: event.target.checked })}
        />
        {t('settings.codeInterpreterArtifacts')}
      </label>
    </SettingsSection>
  );
};
