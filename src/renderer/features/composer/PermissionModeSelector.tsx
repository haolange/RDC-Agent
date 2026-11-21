import React, { useCallback } from 'react';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Chevron } from '../../ui/Chevron';
import { Pill } from '../../ui/Pill';
import { useRuntimePermissionStore } from '../../stores/runtimePermissionStore';
import { InlineError } from '../../ui/InlineError';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useComposerMenu } from './useComposerMenuRegistry';
import type { TranslationKey } from '../../i18n';
import type { AgentPermissionMode } from '@shared/types/settings';

const PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

const labelKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}`;
const descKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}Desc`;

export const PermissionModeSelector: React.FC = () => {
  const { t } = useI18n();
  const menu = useComposerMenu('permission');
  const snapshot = useRuntimePermissionStore((state) => state.snapshot);
  const pendingMode = useRuntimePermissionStore((state) => state.pendingMode);
  const error = useRuntimePermissionStore((state) => state.error);
  const refresh = useRuntimePermissionStore((state) => state.refresh);
  const mode = snapshot?.mode;
  const setMode = useAppSettingsStore((state) => state.setAgentPermissionMode);
  const current = mode ?? 'default';
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    menu.setRoot(node);
  }, [menu]);
  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  const selectMode = (nextMode: AgentPermissionMode) => {
    menu.close();
    if (nextMode === mode && !pendingMode) return;
    void setMode(nextMode).catch(() => undefined);
  };

  return (
    <div ref={setRootRef} className="composer-permission-menu">
      <Pill
        ref={setTriggerRef}
        className={`composer-permission-pill ${menu.open ? 'is-open' : ''}`}
        selected={menu.open}
        data-testid="composer-permission-pill"
        data-mode={mode}
        aria-busy={pendingMode !== null}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-tooltip={snapshot ? `${t(labelKey(current))} · ${t(descKey(current))}` : t('composer.permission.loading')}
        onClick={() => menu.toggle()}
      >
        <span className="composer-permission-pill-icon" aria-hidden="true">
          <Icon name="shield" size={14} />
        </span>
        <span className="composer-permission-pill-label">{pendingMode ? t('composer.permission.saving') : snapshot ? t(labelKey(current)) : t('composer.permission.loading')}</span>
        <span className="composer-permission-pill-caret" aria-hidden="true">
          <Chevron direction="down" size={12} />
        </span>
      </Pill>
      {menu.open ? (
        <div className="composer-permission-popup" role="menu">
          {PERMISSION_MODES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`composer-permission-menu-item ${entry === mode ? 'is-selected' : ''}`}
              data-mode={entry}
              data-tooltip={t(descKey(entry))}
              role="menuitemradio"
              aria-checked={entry === mode}
              disabled={!snapshot}
              onClick={() => selectMode(entry)}
            >
              <span className="composer-permission-menu-label">{t(labelKey(entry))}</span>
              {entry === mode ? <Icon name="check" size={16} className="composer-permission-menu-check" /> : null}
            </button>
          ))}
          {error ? (
            <InlineError onRetry={() => { void refresh().catch(() => undefined); }} retryLabel={t('composer.permission.retry')}>
              {t('composer.permission.saveFailed')}
            </InlineError>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
