import React from 'react';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';

type Translate = ReturnType<typeof useI18n>['t'];
export type AgentAutosaveState = 'idle' | 'saving' | 'saved' | 'error';

interface AgentAutosaveStatusProps {
  state: AgentAutosaveState;
  message: string;
  blocked?: boolean;
  onRetry: () => void | Promise<unknown>;
  /** Compact = one line inside a section head; otherwise a toolbar strip with the retry action. */
  compact?: boolean;
  t: Translate;
}

/**
 * Agent manifests autosave. The strip is always present so the user can see the current
 * outcome; a failed autosave keeps its own retry semantics and never uses the unsaved-exit dialog.
 */
export const AgentAutosaveStatus: React.FC<AgentAutosaveStatusProps> = ({
  state,
  message,
  blocked = false,
  onRetry,
  compact = false,
  t,
}) => {
  const text = state === 'saving'
    ? t('settings.saving')
    : state === 'error'
      ? (message || t('settings.agentManifestSaveFailed'))
      : state === 'saved'
        ? (message || t('settings.agentManifestSaved'))
        : t('settings.agentAutosaveIdle');
  const icon = state === 'error' ? 'warning' : state === 'saving' ? 'refresh' : 'check';
  return (
    <span
      className={`settings-agent-autosave${compact ? ' is-compact' : ''}`}
      data-state={state}
      data-testid="settings-agent-autosave-status"
      role="status"
    >
      <Icon name={icon} size={14} className="settings-agent-autosave-icon" />
      <span className="settings-agent-autosave-text">{compact && state !== 'error' ? (state === 'saving' ? t('settings.saving') : t('settings.agentAutosaveIdle')) : text}</span>
      {!compact && state === 'error' && !blocked ? (
        <Button variant="secondary" size="sm" onClick={() => void onRetry()}>
          {t('settings.retry')}
        </Button>
      ) : null}
    </span>
  );
};
