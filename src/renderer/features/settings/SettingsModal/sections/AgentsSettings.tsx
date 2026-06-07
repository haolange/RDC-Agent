import React from 'react';
import type { AppSettings, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import DropdownSelect, { type DropdownOption } from '../../../../ui/DropdownSelect';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { resolveAgentRouteStatus } from '../agentRouteStatus';
import { getEnabledModels } from '../utils';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentsSettingsProps {
  settings: AppSettings;
  providerDrafts: LlmProviderEntry[];
  agentRouteDrafts: LlmAgentRoute[];
  routableProviders: LlmProviderEntry[];
  configuredProvidersWithoutEnabledModels: LlmProviderEntry[];
  getResolvedProviderLabel: (provider: Pick<LlmProviderEntry, 'label'>) => string;
  onRouteChange: (agentId: LlmAgentRoute['agentId'], patch: Partial<LlmAgentRoute>) => void;
  onSaveAgentRoutes: () => void | Promise<void>;
  agentRouteSaveState?: 'idle' | 'saving' | 'saved' | 'error';
  agentRouteSaveMessage?: string;
  t: Translate;
}

export const AgentsSettings: React.FC<AgentsSettingsProps> = ({
  settings,
  providerDrafts,
  agentRouteDrafts,
  routableProviders,
  configuredProvidersWithoutEnabledModels,
  getResolvedProviderLabel,
  onRouteChange,
  onSaveAgentRoutes,
  agentRouteSaveState = 'idle',
  agentRouteSaveMessage = '',
  t,
}) => {
  const invalidAgentRoutes = AGENT_ROLES.map((agentId) => {
    const route = agentRouteDrafts.find((entry) => entry.agentId === agentId);
    const routeStatus = resolveAgentRouteStatus(route, providerDrafts);
    return routeStatus.issue ? { agentId, issue: routeStatus.issue } : null;
  }).filter(
    (entry): entry is { agentId: LlmAgentRoute['agentId']; issue: TranslationKey } => entry !== null,
  );
  const invalidAgentRouteMessage = invalidAgentRoutes.length === 0
    ? ''
    : t('settings.agentRouteInvalidSummary', {
      count: invalidAgentRoutes.length,
      routes: invalidAgentRoutes.map((entry) => `${AGENT_DISPLAY_NAMES[entry.agentId]}: ${t(entry.issue)}`).join('; '),
    });

  return (
    <section className="settings-page settings-page-agents">
      <div className="settings-agent-page">
        <div className="settings-agent-page-header">
          <div className="settings-field-label">{t('settings.agentRouting')}</div>
          <div className="settings-help-text">{t('settings.agentsHint')}</div>
          <div className="settings-help-text">
            {t('settings.activeModeProfile')}: {settings.configuration.activeModeProfileId}
          </div>
          {routableProviders.length === 0 && (
            <div className="settings-help-text">{t('settings.noConfiguredProviders')}</div>
          )}
          {configuredProvidersWithoutEnabledModels.length > 0 && (
            <div className="settings-help-text settings-help-text-warning" data-testid="settings-agent-no-enabled-models">
              {t('settings.configuredProvidersWithoutModels', {
                providers: configuredProvidersWithoutEnabledModels.map((provider) => getResolvedProviderLabel(provider)).join(', '),
              })}
            </div>
          )}
        </div>

        <div className="settings-agent-grid-header" aria-hidden="true">
          <span>{t('settings.agentRouting')}</span>
          <span>{t('settings.providerFieldLabel')}</span>
          <span>{t('settings.modelFieldLabel')}</span>
        </div>

        <div className="settings-agent-list scrollbar-thin" data-testid="settings-agent-list">
          {AGENT_ROLES.map((agentId) => {
            const route = agentRouteDrafts.find((entry) => entry.agentId === agentId);
            const routeStatus = resolveAgentRouteStatus(route, providerDrafts);
            const selectedRouteProvider = routableProviders.find((entry) => entry.id === route?.providerId) ?? null;
            const availableModels = selectedRouteProvider ? getEnabledModels(selectedRouteProvider) : [];
            const providerValue = selectedRouteProvider?.id ?? '';
            const modelValue = availableModels.some((model) => model.id === route?.modelId) ? route?.modelId ?? '' : '';
            const isInvalid = routeStatus.issue !== null;

            return (
              <div
                key={agentId}
                className={`settings-agent-card ${isInvalid ? 'invalid' : ''}`}
                data-testid={`settings-agent-card-${agentId}`}
              >
                <div className="settings-agent-card-head">
                  <span>{AGENT_DISPLAY_NAMES[agentId]}</span>
                  {routeStatus.issue && <span className="settings-agent-warning">{t(routeStatus.issue)}</span>}
                </div>
                <div className="settings-agent-route-control">
                  <DropdownSelect
                    triggerClassName="settings-select-trigger settings-agent-select-trigger"
                    menuClassName="settings-select-menu"
                    dataTestId={`settings-agent-provider-${agentId}`}
                    ariaLabel={`${AGENT_DISPLAY_NAMES[agentId]} ${t('settings.providerFieldLabel')}`}
                    value={providerValue}
                    options={routableProviders.map<DropdownOption>((entry) => ({
                      value: entry.id,
                      label: getResolvedProviderLabel(entry),
                    }))}
                    placeholder={routableProviders.length === 0
                      ? t('settings.noConfiguredProviders')
                      : t('settings.selectProviderPlaceholder')}
                    onChange={(nextProviderId) => {
                      if (!nextProviderId) {
                        onRouteChange(agentId, { providerId: '', modelId: '' });
                        return;
                      }

                      const nextProvider = routableProviders.find((entry) => entry.id === nextProviderId)
                        ?? providerDrafts.find((entry) => entry.id === nextProviderId);
                      onRouteChange(agentId, {
                        providerId: nextProviderId,
                        modelId: getEnabledModels(nextProvider)[0]?.id ?? '',
                      });
                    }}
                    disabled={routableProviders.length === 0}
                  />
                </div>
                <div className="settings-agent-route-control">
                  <DropdownSelect
                    triggerClassName="settings-select-trigger settings-agent-select-trigger"
                    menuClassName="settings-select-menu"
                    dataTestId={`settings-agent-model-${agentId}`}
                    ariaLabel={`${AGENT_DISPLAY_NAMES[agentId]} ${t('settings.modelFieldLabel')}`}
                    value={modelValue}
                    options={availableModels.map<DropdownOption>((model) => ({
                      value: model.id,
                      label: model.label,
                    }))}
                    placeholder={!selectedRouteProvider
                      ? t('settings.selectProviderFirst')
                      : t('settings.noModelsAvailable')}
                    onChange={(nextModelId) => onRouteChange(agentId, { modelId: nextModelId })}
                    disabled={!selectedRouteProvider || availableModels.length === 0}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {(invalidAgentRouteMessage || agentRouteSaveMessage) && (
          <div
            className={`settings-provider-notice ${agentRouteSaveState === 'saved' ? 'success' : 'error'}`}
            data-testid="settings-agent-route-save-status"
          >
            {agentRouteSaveMessage || invalidAgentRouteMessage}
          </div>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="button button-primary"
            data-testid="settings-agent-save"
            onClick={() => void onSaveAgentRoutes()}
            disabled={agentRouteSaveState === 'saving'}
          >
            {agentRouteSaveState === 'saving' ? t('settings.saving') : t('settings.saveAgentRouting')}
          </button>
        </div>
      </div>
    </section>
  );
};
