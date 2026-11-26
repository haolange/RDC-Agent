import React from 'react';
import { Icon } from '../../../../ui/Icon';
import { Spinner } from '../../../../ui/Spinner';
import { useI18n } from '../../../../i18n';
import type { ProviderConnectionDraft } from '../types';

export type ProviderConnectionPhase = 'untested' | 'testing' | 'testPassed' | 'connected' | 'failed' | 'saving';

/**
 * The draft's connection state. `savedConnected` is a verified saved connection the draft has not changed,
 * which reads as connected without testing it again; a passing test of unsaved changes is only that.
 */
export function connectionPhase(
  draft: ProviderConnectionDraft,
  hasFreshTest: boolean,
  savedConnected = false,
): ProviderConnectionPhase {
  if (draft.busy === 'testing') return 'testing';
  if (draft.busy === 'saving') return 'saving';
  if (draft.error) return 'failed';
  if (savedConnected) return 'connected';
  if (hasFreshTest) return 'testPassed';
  return 'untested';
}

/** One status line for the current connection draft across provider types. */
export const ProviderConnectionStatusLine: React.FC<{ phase: ProviderConnectionPhase }> = ({ phase }) => {
  const { t } = useI18n();
  return (
    <div
      className="settings-provider-connection-status"
      role="status"
      aria-label={t('settings.providers.connectionStatus')}
      data-testid="settings-provider-connection-status"
      data-phase={phase}
    >
      {phase === 'testing' || phase === 'saving' ? <Spinner size="sm" /> : null}
      {phase === 'connected' || phase === 'testPassed' ? <Icon name="check" size={14} /> : null}
      <span>{t(`settings.providers.connectionPhase.${phase}` as const)}</span>
    </div>
  );
};

/** Empty discovery pane shown before the first successful test. */
export const ProviderDiscoveryEmpty: React.FC<{}> = ({}) => {
  const { t } = useI18n();
  return (
    <div className="settings-provider-discovery-empty" data-testid="settings-provider-discovery-empty">
      <Icon name="nav-models" size={20} />
      <span>{t('settings.providers.discoveryEmpty')}</span>
    </div>
  );
};
