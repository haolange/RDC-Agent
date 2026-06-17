import React, { useMemo, useState } from 'react';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

const PERMISSION_MODES: AgentPermissionMode[] = [
  'default',
  'auto-review',
  'full-access',
  'custom',
];

const splitPathLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const joinPathLines = (values: string[]): string => values.join('\n');

interface AgentPermissionsSettingsProps {
  permissionModeDraft: AgentPermissionMode;
  readableRootsDraft: string;
  writableRootsDraft: string;
  onPermissionModeDraftChange: (mode: AgentPermissionMode) => void;
  onReadableRootsDraftChange: (value: string) => void;
  onWritableRootsDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  t: Translate;
}

export const AgentPermissionsSettings: React.FC<AgentPermissionsSettingsProps> = ({
  permissionModeDraft,
  readableRootsDraft,
  writableRootsDraft,
  onPermissionModeDraftChange,
  onReadableRootsDraftChange,
  onWritableRootsDraftChange,
  onSave,
  t,
}) => {
  const [busy, setBusy] = useState(false);
  const readableCount = useMemo(() => splitPathLines(readableRootsDraft).length, [readableRootsDraft]);
  const writableCount = useMemo(() => splitPathLines(writableRootsDraft).length, [writableRootsDraft]);
  const rootsOpen = permissionModeDraft === 'custom' || readableCount > 0 || writableCount > 0;

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section settings-agent-permissions" data-testid="settings-agent-permissions">
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('settings.agentPermissionsTitle')}</div>
          <div className="settings-section-subtitle">{t('settings.agentPermissionsHint')}</div>
        </div>
        <button
          type="button"
          className="button button-primary"
          data-testid="settings-agent-permissions-save"
          disabled={busy}
          onClick={() => void handleSave()}
        >
          {t('settings.saveAgentPermissions')}
        </button>
      </div>

      <div className="settings-preference-list">
        <div className="settings-preference-row">
          <div className="settings-preference-copy settings-option-block">
            <div className="settings-field-label">{t('settings.agentPermissionMode')}</div>
            <div className="settings-help-text">{t('settings.agentPermissionModeHint')}</div>
          </div>
          <div className="user-menu-pill-group settings-inline-pills settings-choice-group">
            {PERMISSION_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`user-menu-pill ${permissionModeDraft === mode ? 'active' : ''}`}
                data-testid={`settings-agent-permission-mode-${mode}`}
                onClick={() => onPermissionModeDraftChange(mode)}
              >
                {t(`settings.permissionMode.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <details className="settings-agent-permission-roots" open={rootsOpen}>
          <summary>
            <span>{t('settings.agentPermissionRootsTitle')}</span>
            <small>
              {t('settings.agentPermissionRootsSummary', {
                readable: String(readableCount),
                writable: String(writableCount),
              })}
            </small>
          </summary>
          <div className="settings-agent-permission-roots-grid">
            <div className="settings-field-block">
              <div className="settings-field-label">{t('settings.readableRoots')}</div>
              <div className="settings-help-text">{t('settings.readableRootsHint')}</div>
              <textarea
                className="input settings-agent-textarea-compact"
                data-testid="settings-agent-readable-roots"
                rows={3}
                value={readableRootsDraft}
                placeholder={t('settings.pathRootsPlaceholder')}
                onChange={(event) => onReadableRootsDraftChange(event.target.value)}
              />
              <div className="settings-help-text">{t('settings.pathRootsCount', { count: String(readableCount) })}</div>
            </div>

            <div className="settings-field-block">
              <div className="settings-field-label">{t('settings.writableRoots')}</div>
              <div className="settings-help-text">{t('settings.writableRootsHint')}</div>
              <textarea
                className="input settings-agent-textarea-compact"
                data-testid="settings-agent-writable-roots"
                rows={3}
                value={writableRootsDraft}
                placeholder={t('settings.pathRootsPlaceholder')}
                onChange={(event) => onWritableRootsDraftChange(event.target.value)}
              />
              <div className="settings-help-text">{t('settings.pathRootsCount', { count: String(writableCount) })}</div>
            </div>

            <p className="settings-help-text">{t('settings.agentPermissionsCustomNote')}</p>
          </div>
        </details>
      </div>
    </section>
  );
};

export { splitPathLines, joinPathLines };
