import React, { type Dispatch, type SetStateAction } from 'react';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Input } from '../../../../ui/Input';
import { Switch } from '../../../../ui/Switch';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { envToText, splitArgs, textToEnv } from './toolEnvText';

type Translate = ReturnType<typeof useI18n>['t'];

interface RdxCliInvokerSettingsFieldsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  t: Translate;
}

/**
 * Local RenderDoc CLI toolchain (machine-local). Every field is visible when the
 * disclosure is open; the enable switch sits in the section head.
 */
export const RdxCliInvokerSettingsFields: React.FC<RdxCliInvokerSettingsFieldsProps> = ({
  rdxCliDraft,
  onRdxCliDraftChange,
  t,
}) => {
  const patch = (next: Partial<RdxCliInvokerSettings>) => {
    onRdxCliDraftChange((current) => ({ ...current, ...next }));
  };

  return (
    <section className="settings-local-tool-form settings-renderdoc-toolchain" data-testid="settings-rdx-toolchain">
      <header className="settings-local-tool-form-head">
        <div>
          <p className="settings-help-text">{t('settings.localRenderDocToolchainHint')}</p>
        </div>
        <label className="settings-switch-row">
          <span>{rdxCliDraft.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
          <Switch
            checked={rdxCliDraft.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label={t('settings.rdxCliEnabled')}
            data-testid="settings-rdx-enabled"
          />
        </label>
      </header>

      <div className="settings-local-tool-grid">
        <SettingsField label={t('settings.rdxCliCommand')} layout="row">
          <Input
            value={rdxCliDraft.command}
            placeholder="C:\\Tools\\rdx\\bin\\rdx.exe"
            spellCheck={false}
            onChange={(event) => patch({ command: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliArgsPrefix')} layout="row" description={t('settings.rdxCliArgsPrefixHint')}>
          <Input
            value={rdxCliDraft.argsPrefix.join(' ')}
            placeholder="--non-interactive --json"
            spellCheck={false}
            onChange={(event) => patch({ argsPrefix: splitArgs(event.currentTarget.value) })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliWorkingDirectory')} layout="row">
          <Input
            value={rdxCliDraft.workingDirectory}
            placeholder="C:\\Tools\\rdx"
            spellCheck={false}
            onChange={(event) => patch({ workingDirectory: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliCatalogPath')} layout="row">
          <Input
            value={rdxCliDraft.catalogPath}
            placeholder="C:\\Tools\\rdx\\spec\\tool_catalog.json"
            spellCheck={false}
            onChange={(event) => patch({ catalogPath: event.currentTarget.value })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliTimeoutMs')} layout="row">
          <Input
            type="number"
            min={1000}
            max={600000}
            step={1000}
            value={rdxCliDraft.timeoutMs}
            onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })}
          />
        </SettingsField>
        <SettingsField label={t('settings.rdxCliEnv')} layout="row" description={t('settings.envLineHint')}>
          <AutosizeTextarea
            maxHeight={180}
            className="input settings-rdx-cli-textarea"
            value={envToText(rdxCliDraft.env)}
            placeholder="NAME=value"
            spellCheck={false}
            onChange={(event) => patch({ env: textToEnv(event.currentTarget.value) })}
          />
        </SettingsField>
      </div>
    </section>
  );
};
