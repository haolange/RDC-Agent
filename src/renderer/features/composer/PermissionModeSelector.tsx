import React, { useCallback } from 'react';
import type { AgentPermissionMode } from '@shared/types/settings';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useComposerMenu } from './useComposerMenuRegistry';

const PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

const labelKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}`;
const descKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}Desc`;

export const PermissionModeSelector: React.FC = () => {
  const { t } = useI18n();
  const menu = useComposerMenu('permission');
  const mode = useAppSettingsStore((state) => state.settings.agentRuntime?.permissions?.mode ?? 'default');
  const setMode = useAppSettingsStore((state) => state.setAgentPermissionMode);
  const current = PERMISSION_MODES.includes(mode) ? mode : 'default';
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    menu.setRoot(node);
  }, [menu]);
  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  const selectMode = (nextMode: AgentPermissionMode) => {
    menu.close();
    if (nextMode === mode) return;
    void setMode(nextMode);
  };

  return (
    <div ref={setRootRef} className="composer-permission-menu">
      <Pill
        ref={setTriggerRef}
        className={`composer-permission-pill ${menu.open ? 'open' : ''}`}
        selected={menu.open}
        data-testid="composer-permission-pill"
        data-mode={current}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={`${t(labelKey(current))} — ${t(descKey(current))}`}
        onClick={() => menu.toggle()}
      >
        <span className="composer-permission-pill-icon" aria-hidden="true">
          <Icon name="shield" size={14} />
        </span>
        <span className="composer-permission-pill-label">{t(labelKey(current))}</span>
        <span className="composer-permission-pill-caret" aria-hidden="true">
          <Icon name="chevron-down" size={12} />
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
              role="menuitemradio"
              aria-checked={entry === mode}
              onClick={() => selectMode(entry)}
            >
              <span className="composer-permission-menu-label">{t(labelKey(entry))}</span>
              <span className="composer-permission-menu-desc">{t(descKey(entry))}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
