import React, { useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Chevron } from '../../ui/Chevron';
import { Pill } from '../../ui/Pill';
import { useRuntimePermissionStore } from '../../stores/runtimePermissionStore';
import { InlineError } from '../../ui/InlineError';
import { PlainButton } from '../../ui/PlainButton';
import { useComposerMenu } from './useComposerMenuRegistry';
import type { TranslationKey } from '../../i18n';
import type { AgentPermissionMode } from '@shared/types/settings';

const PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];

const labelKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}`;
const descKey = (id: AgentPermissionMode): TranslationKey => `composer.permission.${id}Desc`;

/** Arrow keys move through the modes, Home and End jump to the ends; Escape belongs to the menu registry. */
const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'),
  );
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const target =
    event.key === 'ArrowDown'
      ? (index + 1) % items.length
      : event.key === 'ArrowUp'
        ? index <= 0
          ? items.length - 1
          : index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : null;
  if (target === null) return;
  event.preventDefault();
  items[target].focus({ preventScroll: true });
};

export const PermissionModeSelector: React.FC = () => {
  const { t } = useI18n();
  const menu = useComposerMenu('permission');
  const popupRef = useRef<HTMLDivElement>(null);
  const snapshot = useRuntimePermissionStore((state) => state.snapshot);
  const pendingMode = useRuntimePermissionStore((state) => state.pendingMode);
  const error = useRuntimePermissionStore((state) => state.error);
  const refresh = useRuntimePermissionStore((state) => state.refresh);
  const mode = snapshot?.mode;
  const setMode = useRuntimePermissionStore((state) => state.saveMode);
  const current = mode ?? 'default';
  // The label names the mode being applied while main confirms it; the pill's tone stays the confirmed mode's.
  const shown = pendingMode ?? current;
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      menu.setRoot(node);
    },
    [menu],
  );
  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      menu.setTrigger(node);
    },
    [menu],
  );

  useEffect(() => {
    if (!menu.open) return;
    const items = popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)');
    const selected = popupRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? items?.[0])?.focus({ preventScroll: true });
  }, [menu.open]);

  const selectMode = (nextMode: AgentPermissionMode) => {
    menu.close();
    if (nextMode === mode && !pendingMode) return;
    void setMode(nextMode).catch(() => undefined);
  };

  return (
    <div ref={setRootRef} className="composer-permission-menu">
      <Pill
        ref={setTriggerRef}
        className={`composer-permission-pill${menu.open ? ' is-open' : ''}${pendingMode ? ' is-pending' : ''}`}
        selected={menu.open}
        data-testid="composer-permission-pill"
        data-mode={mode}
        aria-busy={pendingMode !== null}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-tooltip={
          pendingMode
            ? `${t('composer.permission.saving')} · ${t(labelKey(pendingMode))}`
            : snapshot
              ? `${t(labelKey(current))} · ${t(descKey(current))}`
              : t('composer.permission.loading')
        }
        onClick={() => menu.toggle()}
      >
        <span className="composer-permission-pill-icon" aria-hidden="true">
          <Icon name="shield" size={14} />
        </span>
        {/* Every mode's name shares one cell sized to the widest, so switching never changes the pill's width. */}
        <span className="composer-permission-pill-label">
          {snapshot ? (
            PERMISSION_MODES.map((entry) => (
              <span
                key={entry}
                className={`composer-permission-pill-label-option${entry === shown ? ' is-shown' : ''}`}
                aria-hidden={entry === shown ? undefined : true}
              >
                {t(labelKey(entry))}
              </span>
            ))
          ) : (
            <span className="composer-permission-pill-label-option is-shown">{t('composer.permission.loading')}</span>
          )}
        </span>
        <span className="composer-permission-pill-caret" aria-hidden="true">
          <Chevron direction="down" size={12} />
        </span>
      </Pill>
      {menu.open ? (
        <div ref={popupRef} className="composer-permission-popup" role="menu" onKeyDown={moveFocus}>
          {PERMISSION_MODES.map((entry) => (
            <PlainButton
              key={entry}
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
            </PlainButton>
          ))}
          {error && !snapshot ? (
            <InlineError
              onRetry={() => {
                void refresh().catch(() => undefined);
              }}
              retryLabel={t('composer.permission.retry')}
            >
              {t('composer.permission.saveFailed')}
            </InlineError>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/** A switch main did not confirm stays visible in the Composer footer, with a retry of that switch. */
export const PermissionSwitchNotice: React.FC = () => {
  const { t } = useI18n();
  const failedSwitch = useRuntimePermissionStore((state) => state.failedSwitch);
  const pending = useRuntimePermissionStore((state) => state.pendingMode !== null);
  const setMode = useRuntimePermissionStore((state) => state.saveMode);
  if (!failedSwitch) return null;
  return (
    <InlineError
      data-testid="composer-permission-notice"
      detail={failedSwitch.detail}
      retryDisabled={pending}
      onRetry={() => {
        void setMode(failedSwitch.mode).catch(() => undefined);
      }}
    >
      {t('composer.permission.switchFailed', { mode: t(labelKey(failedSwitch.mode)) })}
    </InlineError>
  );
};
