import type {
  LlmProviderConnectionField,
  LlmProviderConnectionSchema,
  LlmProviderEntry,
} from '@shared/types/settings';
import type { ProviderConnectionDraft } from './types';

const sortedRecord = (value: Readonly<Record<string, string | boolean>>): Record<string, string | boolean> => (
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
);

export function resolvePrimarySecretField(
  schema: LlmProviderConnectionSchema | undefined,
): LlmProviderConnectionField | undefined {
  const secrets = schema?.fields.filter((field) => field.kind === 'secret') ?? [];
  return secrets.find((field) => field.id === schema?.primarySecretFieldId)
    ?? secrets.find((field) => field.id === 'apiKey')
    ?? secrets[0];
}

export function getConnectionDraftSignature(draft: ProviderConnectionDraft): string {
  return JSON.stringify({
    authMode: draft.authMode,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl.trim(),
    values: sortedRecord(draft.connectionValues),
    storedSecrets: sortedRecord(draft.usingStoredConnectionSecrets),
  });
}

export function getConnectionRequestValues(draft: ProviderConnectionDraft): Record<string, string> {
  return Object.fromEntries(Object.entries(draft.connectionValues).filter(([fieldId, value]) => (
    !draft.usingStoredConnectionSecrets[fieldId] && Boolean(value.trim())
  )));
}

export function isConnectionDraftComplete(
  provider: LlmProviderEntry,
  draft: ProviderConnectionDraft,
): boolean {
  const schema = provider.connectionSchema;
  if (!schema?.fields.length) {
    return provider.authMode !== 'api-key'
      || draft.usingStoredSecret
      || Boolean(draft.apiKey.trim());
  }
  const isPresent = (fieldId: string): boolean => (
    draft.usingStoredConnectionSecrets[fieldId]
    || Boolean(draft.connectionValues[fieldId]?.trim())
  );
  const alternativeFieldIds = new Set(
    schema.credentialAlternatives?.flatMap((alternative) => alternative.fieldIds) ?? [],
  );
  const requiredFieldsPresent = schema.fields
    .filter((field) => field.required && !alternativeFieldIds.has(field.id))
    .every((field) => isPresent(field.id));
  if (!requiredFieldsPresent) return false;
  return !schema.credentialAlternatives?.length
    || schema.credentialAlternatives.some((alternative) => (
      alternative.ambient === true
      || (alternative.fieldIds.length > 0 && alternative.fieldIds.every(isPresent))
    ));
}

export function projectEndpointTemplate(
  template: string | undefined,
  values: Readonly<Record<string, string>>,
): string {
  return (template ?? '').replace(/\$\{([^}]+)\}/gu, (placeholder, fieldId: string) => (
    values[fieldId]?.trim() || placeholder
  ));
}

export function shouldUseProviderDocsLink(provider: LlmProviderEntry): boolean {
  const usesTypedConnectionSchema = (provider.connectionSchema?.fields ?? [])
    .some((field) => field.id !== 'apiKey');
  return provider.authMode === 'local'
    || provider.authMode === 'account'
    || provider.authMode === 'environment'
    || usesTypedConnectionSchema;
}

export function projectConnectionProvider(
  provider: LlmProviderEntry | null,
  draft: ProviderConnectionDraft | null,
): LlmProviderEntry | null {
  if (!provider || !draft) return provider;
  const authMode = draft.authMode;
  const availability = provider.authModeAvailability?.[authMode] ?? provider.providerAvailability;
  const isConfigured = provider.configuredAuthMode === authMode && provider.isConfigured;
  return {
    ...provider,
    authMode,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl,
    activeAccountId: provider.authAccountIds?.[authMode],
    hasStoredSecret: provider.hasStoredSecretByAuthMode?.[authMode] === true,
    status: availability.state === 'unavailable'
      ? 'unavailable'
      : isConfigured
        ? provider.status
        : 'unconfigured',
    enabled: isConfigured && provider.enabled,
    isConfigured,
    unavailableReason: availability.state === 'unavailable' ? availability.reason : undefined,
  };
}

export function createProviderConnectionDraft(provider: LlmProviderEntry): ProviderConnectionDraft {
  const models = provider.models.map((model) => ({ ...model }));
  const connectionValues = Object.fromEntries((provider.connectionSchema?.fields ?? []).map((field) => [
    field.id,
    field.kind === 'secret' ? '' : provider.connectionValues?.[field.id] ?? '',
  ]));
  const usingStoredConnectionSecrets = Object.fromEntries(
    (provider.connectionSchema?.fields ?? [])
      .filter((field) => field.kind === 'secret')
      .map((field) => [field.id, provider.hasStoredConnectionSecrets?.[field.id] === true]),
  );
  const primarySecretField = resolvePrimarySecretField(provider.connectionSchema);
  const routeTemplate = provider.connectionSchema?.endpointTemplate;
  return {
    providerId: provider.id,
    authMode: provider.authMode,
    protocol: provider.protocol,
    connectionValues,
    usingStoredConnectionSecrets,
    visibleConnectionSecrets: {},
    apiKey: '',
    baseUrl: routeTemplate?.includes('${') ? routeTemplate : provider.baseUrl ?? routeTemplate ?? '',
    showApiKey: false,
    usingStoredSecret: primarySecretField
      ? usingStoredConnectionSecrets[primarySecretField.id] === true
      : provider.authMode === 'api-key'
        && (provider.hasStoredSecretByAuthMode?.['api-key'] ?? provider.hasStoredSecret),
    busy: 'idle',
    error: '',
    discoveryDiagnostic: null,
    testedApiKey: '',
    testedBaseUrl: '',
    testedProtocol: provider.protocol,
    testedAuthMode: provider.authMode,
    testedConnectionSignature: '',
    models,
    accountStatus: provider.authMode === 'account' && provider.configuredAuthMode === 'account' && provider.isConfigured
      ? {
          providerId: provider.id,
          state: 'connected',
          available: true,
          connected: true,
          accountLabel: provider.accountLabel,
          planLabel: provider.planLabel,
          expiresAt: provider.oauthExpiresAt,
          models,
        }
      : undefined,
    accountLoginMode: provider.id === 'grok-account' ? 'browser' : 'device',
    authCode: '',
  };
}
