import {
  getConnectionDraftSignature,
  getConnectionRequestValues,
  projectEndpointTemplate,
} from './providerConnectionState';
import { mergeTestedProviderModels } from './providerModelProjection';
import type { LlmProviderEntry, LlmProviderModel, LlmProviderModelPreference } from '@shared/types/settings';
import type { ProviderConnectionDraft } from './types';

export function projectProviderModelPreferences(draft: ProviderConnectionDraft | null): LlmProviderModelPreference[] {
  return (
    draft?.models.map((model) => ({
      id: model.id,
      enabled: model.enabled,
      defaultReasoningSelection: model.defaultReasoningSelection,
      defaultBudgetTokens: model.defaultBudgetTokens,
      preferredRouteOptionId: model.preferredRouteOptionId,
    })) ?? []
  );
}

export function hasProviderConnectionDefinitionChanged(
  storedProvider: LlmProviderEntry | undefined,
  draft: ProviderConnectionDraft,
): boolean {
  if (!storedProvider) return true;
  const connectionValuesChanged = (storedProvider.connectionSchema?.fields ?? []).some((field) =>
    field.kind === 'secret'
      ? !draft.usingStoredConnectionSecrets[field.id] && Boolean(draft.connectionValues[field.id]?.trim())
      : (storedProvider.connectionValues?.[field.id] ?? '').trim() !== (draft.connectionValues[field.id] ?? '').trim(),
  );
  const resolvedBaseUrl = projectEndpointTemplate(
    draft.baseUrl || storedProvider.connectionSchema?.endpointTemplate,
    draft.connectionValues,
  )
    .trim()
    .replace(/\/+$/, '');
  return (
    storedProvider.configuredAuthMode !== draft.authMode ||
    storedProvider.protocol !== draft.protocol ||
    (storedProvider.baseUrl ?? '').replace(/\/+$/, '') !== resolvedBaseUrl ||
    connectionValuesChanged ||
    (!draft.usingStoredSecret && Boolean(draft.apiKey.trim()))
  );
}

/** What main needs to test or connect the drafted connection; a stored secret is reused, never resent. */
export function providerConnectionRequest(draft: ProviderConnectionDraft) {
  return {
    providerId: draft.providerId,
    authMode: draft.authMode,
    apiKey: draft.usingStoredSecret ? '' : draft.apiKey,
    baseUrl: draft.baseUrl,
    protocol: draft.protocol,
    connectionValues: getConnectionRequestValues(draft),
  };
}

/** A passing test: which connection it checked, so a later edit outdates it, and the models it discovered. */
export function testedConnectionPatch(
  draft: ProviderConnectionDraft,
  result: {
    discoveryDiagnostic?: ProviderConnectionDraft['discoveryDiagnostic'];
    discoveryAccountId?: string | null;
    models: LlmProviderModel[];
  },
): Partial<ProviderConnectionDraft> {
  return {
    busy: 'idle',
    error: '',
    discoveryDiagnostic: result.discoveryDiagnostic ?? null,
    testedApiKey: draft.apiKey,
    testedBaseUrl: draft.baseUrl,
    testedProtocol: draft.protocol,
    testedAuthMode: draft.authMode,
    testedConnectionSignature: getConnectionDraftSignature(draft),
    discoveryAccountId: result.discoveryAccountId ?? null,
    models: mergeTestedProviderModels(result.models, draft.models),
  };
}
