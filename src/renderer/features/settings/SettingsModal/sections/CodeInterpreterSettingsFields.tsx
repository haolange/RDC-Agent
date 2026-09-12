import React, { useState } from 'react';
import type { CodeInterpreterSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Checkbox } from '../../../../ui/Checkbox';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { envToText, splitArgs, textToEnv } from './toolEnvText';

type Translate = ReturnType<typeof useI18n>['t'];

interface CodeInterpreterSettingsFieldsProps {
  draft: CodeInterpreterSettings;
  onChange: (next: CodeInterpreterSettings) => void;
  t: Translate;
}

/** Code interpreter (machine-local): a fixed two-column field grid; saving belongs to the Tools form. */
export const CodeInterpreterSettingsFields: React.FC<CodeInterpreterSettingsFieldsProps> = ({ draft, onChange, t }) => {
  const [envText, setEnvText] = useState(() => envToText(draft.env));
  const [argsText, setArgsText] = useState(() => draft.argsPrefix.join(' '));
  const [timeoutText, setTimeoutText] = useState(() => String(draft.timeoutMs));

  return (
    <section className="settings-local-tool-form" data-testid="settings-code-interpreter" data-settings-search="code-interpreter">
      <header className="settings-local-tool-form-head">
        <label className="settings-switch-row">
          <span>{t('settings.codeInterpreterEnabled')}</span>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
            aria-label={t('settings.codeInterpreterEnabled')}
            data-testid="settings-code-interpreter-enabled"
          />
        </label>
      </header>

      <div className="settings-interpreter-grid">
        <SettingsField label={t('settings.codeInterpreterCommand')}>
          <Input
            type="text"
            value={draft.command}
            spellCheck={false}
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
            placeholder="python"
          />
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterTimeout')}>
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
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterArgs')} description={t('settings.rdxCliArgsPrefixHint')}>
          <Input
            type="text"
            value={argsText}
            spellCheck={false}
            onChange={(event) => {
              setArgsText(event.target.value);
              onChange({ ...draft, argsPrefix: splitArgs(event.target.value) });
            }}
          />
        </SettingsField>
        <SettingsField label={t('settings.codeInterpreterEnv')} description={t('settings.envLineHint')}>
          <AutosizeTextarea
            maxHeight={140}
            className="input"
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
        <SettingsField className="settings-interpreter-artifacts" layout="row" label={t('settings.codeInterpreterArtifacts')} description={t('settings.codeInterpreterArtifactsHint')}>
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
