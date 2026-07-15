import type { LlmProviderEntry, LlmProviderModelPreference } from '@shared/types/settings';
import type { ProviderConnectionDraft } from './types';
import { projectEndpointTemplate } from './providerConnectionState';

export function projectProviderModelPreferences(
  draft: ProviderConnectionDraft | null,
): LlmProviderModelPreference[] {
  return draft?.models.map((model) => ({
    id: model.id,
    enabled: model.enabled,
    defaultReasoningSelection: model.defaultReasoningSelection,
    defaultBudgetTokens: model.defaultBudgetTokens,
    preferredRouteOptionId: model.preferredRouteOptionId,
  })) ?? [];
}

export function hasProviderConnectionDefinitionChanged(
  storedProvider: LlmProviderEntry | undefined,
  draft: ProviderConnectionDraft,
): boolean {
  if (!storedProvider) return true;
  const connectionValuesChanged = (storedProvider.connectionSchema?.fields ?? []).some((field) => (
    field.kind === 'secret'
      ? !draft.usingStoredConnectionSecrets[field.id]
        && Boolean(draft.connectionValues[field.id]?.trim())
      : (storedProvider.connectionValues?.[field.id] ?? '').trim()
        !== (draft.connectionValues[field.id] ?? '').trim()
  ));
  const resolvedBaseUrl = projectEndpointTemplate(
    draft.baseUrl || storedProvider.connectionSchema?.endpointTemplate,
    draft.connectionValues,
  ).trim().replace(/\/+$/, '');
  return storedProvider.configuredAuthMode !== draft.authMode
    || storedProvider.protocol !== draft.protocol
    || (storedProvider.baseUrl ?? '').replace(/\/+$/, '') !== resolvedBaseUrl
    || connectionValuesChanged
    || (!draft.usingStoredSecret && Boolean(draft.apiKey.trim()));
}
