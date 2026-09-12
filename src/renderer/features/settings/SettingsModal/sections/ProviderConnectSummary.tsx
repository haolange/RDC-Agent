import React from 'react';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Icon } from '../../../../ui/Icon';
import type { ProviderConnectionDraft } from '../types';
import { getProviderProtocolLabel } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

/** Read-only protocol summary: route protocol, endpoint class, operator and catalog ownership from the snapshot. */
export const ProviderProtocolSummary: React.FC<{ provider: LlmProviderEntry; t: Translate }> = ({ provider, t }) => (
  <dl className="settings-provider-summary-grid" data-testid="settings-provider-protocol-summary">
    <div>
      <dt>{t('settings.providers.summary.protocol')}</dt>
      <dd>
        {getProviderProtocolLabel(provider.protocol)}
        {provider.routeCount && provider.routeCount > 1 ? ` · ${t('settings.providers.summary.routes', { count: provider.routeCount })}` : ''}
      </dd>
    </div>
    <div>
      <dt>{t('settings.providers.summary.endpointClass')}</dt>
      <dd>{t(`settings.providers.endpointClass.${provider.endpointClass}` as const)}</dd>
    </div>
    <div>
      <dt>{t('settings.providers.summary.operator')}</dt>
      <dd>{provider.serviceOperator || '—'}</dd>
    </div>
    <div>
      <dt>{t('settings.providers.summary.catalog')}</dt>
      <dd>{t(`settings.providers.catalogOwnership.${provider.catalogOwnership}` as const)}</dd>
    </div>
  </dl>
);

export type ProviderConnectionPhase = 'untested' | 'testing' | 'connected' | 'failed' | 'saving';

export function connectionPhase(draft: ProviderConnectionDraft, hasFreshTest: boolean): ProviderConnectionPhase {
  if (draft.busy === 'testing') return 'testing';
  if (draft.busy === 'saving') return 'saving';
  if (draft.error) return 'failed';
  if (hasFreshTest) return 'connected';
  return 'untested';
}

/** One status line for the current connection draft across provider types. */
export const ProviderConnectionStatusLine: React.FC<{ phase: ProviderConnectionPhase; t: Translate }> = ({ phase, t }) => (
  <div className="settings-provider-connection-status" data-testid="settings-provider-connection-status" data-phase={phase}>
    <span className="settings-provider-connection-status-dot" aria-hidden="true" />
    <span>{t(`settings.providers.connectionPhase.${phase}` as const)}</span>
  </div>
);

/** Empty discovery pane shown before the first successful test. */
export const ProviderDiscoveryEmpty: React.FC<{ t: Translate }> = ({ t }) => (
  <div className="settings-provider-discovery-empty" data-testid="settings-provider-discovery-empty">
    <Icon name="nav-models" size={20} />
    <span>{t('settings.providers.discoveryEmpty')}</span>
  </div>
);
