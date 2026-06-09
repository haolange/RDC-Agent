import React, { type Dispatch, type SetStateAction } from 'react';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface RdxCliInvokerSettingsFieldsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  t: Translate;
}

export const RdxCliInvokerSettingsFields: React.FC<RdxCliInvokerSettingsFieldsProps> = ({
  rdxCliDraft,
  onRdxCliDraftChange,
  t,
}) => {
  const argsPrefixText = rdxCliDraft.argsPrefix.join(' ');
  const envText = Object.entries(rdxCliDraft.env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const patchRdxCliDraft = (patch: Partial<RdxCliInvokerSettings>) => {
    onRdxCliDraftChange((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="settings-tool-section settings-renderdoc-toolchain">
      <div className="settings-field-label">{t('settings.localRenderDocToolchain')}</div>
      <div className="settings-help-text">{t('settings.localRenderDocToolchainHint')}</div>
      <div className={`settings-toolchain-status ${rdxCliDraft.enabled ? 'enabled' : 'disabled'}`}>
        <strong>{rdxCliDraft.enabled ? t('settings.toolchainAvailable') : t('settings.toolchainNotEnabled')}</strong>
        <span>{rdxCliDraft.command || t('settings.toolchainCommandMissing')}</span>
      </div>
      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={rdxCliDraft.enabled}
          onChange={(event) => patchRdxCliDraft({ enabled: event.currentTarget.checked })}
        />
        <span>{t('settings.rdxCliEnabled')}</span>
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliCommand')}</span>
        <input
          className="input settings-rdx-cli-input"
          value={rdxCliDraft.command}
          placeholder="C:\\Tools\\rdx\\bin\\rdx.exe"
          onChange={(event) => patchRdxCliDraft({ command: event.currentTarget.value })}
        />
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliArgsPrefix')}</span>
        <input
          className="input settings-rdx-cli-input"
          value={argsPrefixText}
          placeholder="--non-interactive --json"
          onChange={(event) => patchRdxCliDraft({
            argsPrefix: event.currentTarget.value.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
          })}
        />
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliWorkingDirectory')}</span>
        <input
          className="input settings-rdx-cli-input"
          value={rdxCliDraft.workingDirectory}
          placeholder="C:\\Tools\\rdx"
          onChange={(event) => patchRdxCliDraft({ workingDirectory: event.currentTarget.value })}
        />
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliCatalogPath')}</span>
        <input
          className="input settings-rdx-cli-input"
          value={rdxCliDraft.catalogPath}
          placeholder="C:\\Tools\\rdx\\spec\\tool_catalog.json"
          onChange={(event) => patchRdxCliDraft({ catalogPath: event.currentTarget.value })}
        />
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliTimeoutMs')}</span>
        <input
          className="input settings-rdx-cli-input"
          type="number"
          min={1000}
          max={600000}
          step={1000}
          value={rdxCliDraft.timeoutMs}
          onChange={(event) => patchRdxCliDraft({ timeoutMs: Number(event.currentTarget.value) })}
        />
      </label>
      <label className="settings-input-row">
        <span className="settings-help-text">{t('settings.rdxCliEnv')}</span>
        <textarea
          className="input settings-rdx-cli-input settings-rdx-cli-textarea"
          value={envText}
          placeholder="NAME=value"
          onChange={(event) => {
            const env: Record<string, string> = {};
            for (const line of event.currentTarget.value.split(/\r?\n/)) {
              const separatorIndex = line.indexOf('=');
              if (separatorIndex <= 0) continue;
              const key = line.slice(0, separatorIndex).trim();
              if (!key) continue;
              env[key] = line.slice(separatorIndex + 1);
            }
            patchRdxCliDraft({ env });
          }}
        />
      </label>
    </div>
  );
};
