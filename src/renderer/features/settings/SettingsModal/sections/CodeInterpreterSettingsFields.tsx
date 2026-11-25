import React, { useState } from 'react';
import { Checkbox } from '../../../../ui/Checkbox';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { useI18n } from '../../../../i18n';
import { envToText, splitArgs, textToEnv } from './toolEnvText';
import type { CodeInterpreterSettings } from '@shared/types/settings';

interface CodeInterpreterSettingsFieldsProps {
  draft: CodeInterpreterSettings;
  onChange: (next: CodeInterpreterSettings) => void;
}

export const CodeInterpreterSettingsFields: React.FC<CodeInterpreterSettingsFieldsProps> = ({ draft, onChange }) => {
  const { t } = useI18n();
  const [envText, setEnvText] = useState(() => envToText(draft.env));
  const [argsText, setArgsText] = useState(() => draft.argsPrefix.join(' '));
  const [timeoutText, setTimeoutText] = useState(() => String(draft.timeoutMs / 1000));

  return (
    <section className="settings-local-tool-form" data-testid="settings-code-interpreter" data-settings-search="code-interpreter">
      <div className="settings-local-tool-grid">
        <SettingsField layout="row" label={t('settings.codeInterpreterEnabled')} htmlFor="settings-interpreter-enabled">
          <Switch
            id="settings-interpreter-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
            aria-label={t('settings.codeInterpreterEnabled')}
            data-testid="settings-code-interpreter-enabled"
          />
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterCommand')} htmlFor="settings-interpreter-command">
          <Input
            id="settings-interpreter-command"
            type="text"
            value={draft.command}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
            placeholder="python"
          />
        </SettingsField>
        <SettingsField layout="row" label={t('settings.codeInterpreterTimeout')} htmlFor="settings-interpreter-timeout">
          {/* Stored in milliseconds, edited in seconds. */}
          <Input
            id="settings-interpreter-timeout"
            type="number"
            min={1}
            max={600}
            required
            value={timeoutText}
            onChange={(event) => {
              setTimeoutText(event.target.value);
              onChange({ ...draft, timeoutMs: Math.round(Number(event.target.value) * 1000) });
            }}
          />
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterArgs')} htmlFor="settings-interpreter-args" description={t('settings.rdcCliArgsPrefixHint')}>
          <Input
            id="settings-interpreter-args"
            type="text"
            value={argsText}
            spellCheck={false}
            onChange={(event) => {
              setArgsText(event.target.value);
              onChange({ ...draft, argsPrefix: splitArgs(event.target.value) });
            }}
          />
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterEnv')} htmlFor="settings-interpreter-env" description={t('settings.envLineHint')}>
          <Textarea
            id="settings-interpreter-env"
            data-testid="settings-code-interpreter-env"
            value={envText}
            placeholder="NAME=value"
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value;
              setEnvText(value);
              onChange({ ...draft, env: textToEnv(value) });
              const invalid = value.split(/\r?\n/u).some((line) => line.trim() && (line.indexOf('=') <= 0 || !line.slice(0, line.indexOf('=')).trim()));
              event.target.setCustomValidity(invalid ? t('settings.environmentFormatHint') : '');
            }}
          />
        </SettingsField>
        <SettingsField layout="row" label={t('settings.codeInterpreterArtifacts')} description={t('settings.codeInterpreterArtifactsHint')}>
          <Checkbox
            checked={draft.artifactsEnabled}
            onCheckedChange={(checked) => onChange({ ...draft, artifactsEnabled: checked })}
            aria-label={t('settings.codeInterpreterArtifacts')}
          />
        </SettingsField>
      </div>
    </section>
  );
};
