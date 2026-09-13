import React, { useState, type Dispatch, type SetStateAction } from 'react';
import type { RdxActionId, RdxActionSettingsMap, RdxShellActionSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Icon, type IconName } from '../../../../ui/Icon';
import { Input } from '../../../../ui/Input';
import { ListRow } from '../../../../ui/ListRow';
import { Switch } from '../../../../ui/Switch';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { envToText, splitArgs, textToEnv } from './toolEnvText';

type Translate = ReturnType<typeof useI18n>['t'];
type TranslationKey = Parameters<Translate>[0];

interface RdxActionsFieldsProps {
  rdxActionsDraft: RdxActionSettingsMap;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
  t: Translate;
}

const RDX_ACTIONS: Array<{
  id: RdxActionId;
  icon: IconName;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  argsPlaceholder: string;
}> = [
  {
    id: 'openCapture',
    icon: 'folder',
    labelKey: 'settings.rdxActionOpenCapture',
    hintKey: 'settings.rdxActionOpenCaptureHint',
    argsPlaceholder: '--non-interactive --daemon-context {{contextId}} --json capture open --file {{capturePath}} --frame-index 0',
  },
  {
    id: 'openRemoteCapture',
    icon: 'external',
    labelKey: 'settings.rdxActionOpenRemoteCapture',
    hintKey: 'settings.rdxActionOpenRemoteCaptureHint',
    argsPlaceholder: '--non-interactive --daemon-context {{remoteContextId}} --json capture open --file {{capturePath}} --remote-id {{remoteId}} --frame-index 0',
  },
  {
    id: 'connectRemote',
    icon: 'link',
    labelKey: 'settings.rdxActionConnectRemote',
    hintKey: 'settings.rdxActionConnectRemoteHint',
    argsPlaceholder: '--non-interactive --daemon-context {{deviceId}} --json call rd.remote.connect --args-json {"options":{"transport":"adb_android","device_serial":"{{deviceSerial}}"}} --format json',
  },
  {
    id: 'closeRuntime',
    icon: 'close',
    labelKey: 'settings.rdxActionCloseRuntime',
    hintKey: 'settings.rdxActionCloseRuntimeHint',
    argsPlaceholder: '--non-interactive --daemon-context {{contextId}} --json context clear',
  },
];

/**
 * RDX action configuration (machine-local): a compact action list on the left,
 * the selected action's command / args template / cwd / timeout / env on the right.
 */
export const RdxActionsFields: React.FC<RdxActionsFieldsProps> = ({ rdxActionsDraft, onRdxActionsDraftChange, t }) => {
  const [activeId, setActiveId] = useState<RdxActionId>('openCapture');
  const entry = RDX_ACTIONS.find((candidate) => candidate.id === activeId) ?? RDX_ACTIONS[0];
  const action = rdxActionsDraft[entry.id];

  const patch = (next: Partial<RdxShellActionSettings>) => {
    onRdxActionsDraftChange((current) => ({
      ...current,
      [entry.id]: { ...current[entry.id], ...next },
    }));
  };

  return (
    <section className="settings-local-tool-form settings-renderdoc-actions" data-testid="settings-rdx-actions">
      <header className="settings-local-tool-form-head">
        <div>
          <div className="settings-section-title">
            {t('settings.rdxShellActions')}
            <span className="settings-local-only">{t('settings.localOnly')}</span>
          </div>
          <p className="settings-help-text">{t('settings.rdxShellActionsHint')}</p>
        </div>
      </header>

      <div className="settings-rdx-action-layout">
        <div className="settings-rdx-action-list" role="tablist" aria-label={t('settings.rdxShellActions')}>
          {RDX_ACTIONS.map((candidate) => {
            const state = rdxActionsDraft[candidate.id];
            return (
              <ListRow
                key={candidate.id}
                role="tab"
                aria-selected={candidate.id === entry.id}
                selected={candidate.id === entry.id}
                className="settings-rdx-action-row"
                data-testid={`settings-rdx-action-${candidate.id}`}
                leading={<Icon name={candidate.icon} size={16} />}
                trailing={(
                  <span className={`settings-rdx-action-state ${state.enabled ? 'is-enabled' : 'is-disabled'}`}>
                    {state.enabled ? t('settings.enabled') : t('settings.disabled')}
                  </span>
                )}
                onClick={() => setActiveId(candidate.id)}
              >
                <code>{candidate.id}</code>
              </ListRow>
            );
          })}
        </div>

        <div className="settings-rdx-action-detail" role="tabpanel" data-testid="settings-rdx-action-detail">
          <div className="settings-rdx-action-detail-head">
            <code className="settings-rdx-action-id">{entry.id}</code>
            <span className="settings-help-text">{t(entry.hintKey)}</span>
          </div>
          <div className="settings-local-tool-grid">
            <SettingsField label={t('settings.resourceFieldEnabled')} layout="row">
              <label className="settings-switch-row">
                <Switch
                  checked={action.enabled}
                  onCheckedChange={(enabled) => patch({ enabled })}
                  aria-label={`${t(entry.labelKey)} · ${t('settings.resourceFieldEnabled')}`}
                />
                <span>{action.enabled ? t('settings.enabled') : t('settings.disabled')}</span>
              </label>
            </SettingsField>
            <SettingsField label={t('settings.rdxActionCommand')} layout="row">
              <Input value={action.command} placeholder="rdx" spellCheck={false} onChange={(event) => patch({ command: event.currentTarget.value })} />
            </SettingsField>
            <SettingsField label={t('settings.rdxActionArguments')} layout="row" description={t('settings.rdxActionArgumentsHint')}>
              <AutosizeTextarea
                maxHeight={140}
                className="input settings-rdx-cli-textarea"
                value={action.args.join(' ')}
                placeholder={entry.argsPlaceholder}
                spellCheck={false}
                onChange={(event) => patch({ args: splitArgs(event.currentTarget.value) })}
              />
            </SettingsField>
            <SettingsField label={t('settings.rdxActionWorkingDirectory')} layout="row">
              <Input value={action.workingDirectory} placeholder="{{workspaceRoot}}" spellCheck={false} onChange={(event) => patch({ workingDirectory: event.currentTarget.value })} />
            </SettingsField>
            <SettingsField label={t('settings.rdxActionTimeoutMs')} layout="row">
              <Input type="number" min={1000} max={600000} step={1000} value={action.timeoutMs} onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })} />
            </SettingsField>
            <SettingsField label={t('settings.rdxActionEnvironment')} layout="row" description={t('settings.envLineHint')}>
              <AutosizeTextarea
                maxHeight={140}
                className="input settings-rdx-cli-textarea"
                value={envToText(action.env)}
                placeholder="NAME=value"
                spellCheck={false}
                onChange={(event) => patch({ env: textToEnv(event.currentTarget.value) })}
              />
            </SettingsField>
          </div>
        </div>
      </div>
    </section>
  );
};
