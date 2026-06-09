import React, { type Dispatch, type SetStateAction } from 'react';
import type {
  RdxActionId,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  RdxShellActionSettings,
} from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

interface RdxCliInvokerSettingsFieldsProps {
  rdxCliDraft: RdxCliInvokerSettings;
  rdxActionsDraft: RdxActionSettingsMap;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
  t: Translate;
}

const RDX_ACTIONS: Array<{ id: RdxActionId; label: string; hint: string }> = [
  {
    id: 'openCapture',
    label: 'Open capture',
    hint: 'Receives {{capturePath}} / {{filePath}} and must return runtime context JSON.',
  },
  {
    id: 'connectRemote',
    label: 'Connect remote',
    hint: 'Receives remote target variables and returns remote/session context JSON.',
  },
  {
    id: 'openPreview',
    label: 'Open preview',
    hint: 'Receives the current runtime context and returns preview window details.',
  },
  {
    id: 'closeRuntime',
    label: 'Close runtime',
    hint: 'Receives the current runtime context and releases the owned runtime.',
  },
];

export const RdxCliInvokerSettingsFields: React.FC<RdxCliInvokerSettingsFieldsProps> = ({
  rdxCliDraft,
  rdxActionsDraft,
  onRdxCliDraftChange,
  onRdxActionsDraftChange,
  t,
}) => {
  const argsPrefixText = rdxCliDraft.argsPrefix.join(' ');
  const envText = Object.entries(rdxCliDraft.env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const patchRdxCliDraft = (patch: Partial<RdxCliInvokerSettings>) => {
    onRdxCliDraftChange((current) => ({ ...current, ...patch }));
  };
  const patchRdxActionDraft = (actionId: RdxActionId, patch: Partial<RdxShellActionSettings>) => {
    onRdxActionsDraftChange((current) => ({
      ...current,
      [actionId]: {
        ...current[actionId],
        ...patch,
      },
    }));
  };

  return (
    <>
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

      <div className="settings-tool-section settings-renderdoc-actions" data-testid="settings-rdx-actions">
        <div className="settings-field-label">RDX shell actions</div>
        <div className="settings-help-text">
          Open, connect, preview, and close are configured shell actions for a system-installed RDX CLI. Commands can use placeholders such as {'{{capturePath}}'} and receive the stable runtime context through RDX_* environment variables.
        </div>
        <div className="settings-rdx-action-list">
          {RDX_ACTIONS.map((entry) => {
            const action = rdxActionsDraft[entry.id];
            const argsText = action.args.join(' ');
            const actionEnvText = Object.entries(action.env)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n');
            return (
              <div key={entry.id} className="settings-rdx-action-card" data-testid={`settings-rdx-action-${entry.id}`}>
                <div className="settings-rdx-action-header">
                  <div>
                    <div className="settings-rdx-action-title">{entry.label}</div>
                    <div className="settings-help-text">{entry.hint}</div>
                  </div>
                  <label className="settings-checkbox-row compact">
                    <input
                      type="checkbox"
                      checked={action.enabled}
                      onChange={(event) => patchRdxActionDraft(entry.id, { enabled: event.currentTarget.checked })}
                    />
                    <span>{action.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
                  </label>
                </div>
                <label className="settings-input-row">
                  <span className="settings-help-text">Command</span>
                  <input
                    className="input settings-rdx-cli-input"
                    value={action.command}
                    placeholder="rdx"
                    onChange={(event) => patchRdxActionDraft(entry.id, { command: event.currentTarget.value })}
                  />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">Arguments</span>
                  <input
                    className="input settings-rdx-cli-input"
                    value={argsText}
                    placeholder="capture open --file {{capturePath}} --json"
                    onChange={(event) => patchRdxActionDraft(entry.id, {
                      args: event.currentTarget.value.split(/\s+/).map((value) => value.trim()).filter(Boolean),
                    })}
                  />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">Working directory</span>
                  <input
                    className="input settings-rdx-cli-input"
                    value={action.workingDirectory}
                    placeholder="{{workspaceRoot}}"
                    onChange={(event) => patchRdxActionDraft(entry.id, { workingDirectory: event.currentTarget.value })}
                  />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">Timeout ms</span>
                  <input
                    className="input settings-rdx-cli-input"
                    type="number"
                    min={1000}
                    max={600000}
                    step={1000}
                    value={action.timeoutMs}
                    onChange={(event) => patchRdxActionDraft(entry.id, { timeoutMs: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="settings-input-row">
                  <span className="settings-help-text">Environment</span>
                  <textarea
                    className="input settings-rdx-cli-input settings-rdx-cli-textarea"
                    value={actionEnvText}
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
                      patchRdxActionDraft(entry.id, { env });
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
