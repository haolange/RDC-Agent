import type {
  LlmProviderDraftRequest,
  LlmProviderEntry,
} from '@shared/types/settings';
import {
  isProviderConnectionSchemaSatisfied,
  resolvePrimaryConnectionSecretFieldId,
  resolveProviderEndpointTemplate,
} from './ProviderConnectionSchema';
import { ProviderConnectionError } from './providerConnectionErrors';

interface ResolvedProviderConnectionDraft {
  apiKey: string;
  baseUrl: string;
  values: Record<string, string>;
}

export function resolveProviderConnectionDraft(
  provider: LlmProviderEntry,
  request: Pick<LlmProviderDraftRequest, 'apiKey' | 'baseUrl' | 'connectionValues'>,
  storedValues: Readonly<Record<string, string>> = {},
): ResolvedProviderConnectionDraft {
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(provider.connectionSchema);
  const values: Record<string, string> = {
    ...storedValues,
    ...(request.connectionValues ?? {}),
  };
  const apiKeyDraft = request.apiKey?.trim() ?? '';
  if (apiKeyDraft && primarySecretFieldId) {
    values[primarySecretFieldId] = apiKeyDraft;
  }
  const apiKey = primarySecretFieldId
    ? values[primarySecretFieldId]?.trim() ?? ''
    : apiKeyDraft;
  if (provider.authMode === 'api-key') {
    const schemaSatisfied = provider.connectionSchema?.fields.length
      ? isProviderConnectionSchemaSatisfied(provider.connectionSchema, values)
      : Boolean(apiKey);
    const supportsCredentialResolver = provider.id === 'google-vertex'
      || provider.id === 'google-vertex-anthropic'
      || provider.id === 'amazon-bedrock';
    if (!schemaSatisfied || (!apiKey && !supportsCredentialResolver)) {
      throw new ProviderConnectionError('Provider connection fields are incomplete.');
    }
  }
  const baseUrl = resolveProviderEndpointTemplate(
    provider.connectionSchema,
    values,
    request.baseUrl ?? '',
    provider.baseUrl ?? '',
  );
  return { apiKey, baseUrl, values };
}

/**
 * Account key for writing Test discovery into Effective Catalog.
 * Uncommitted draft secrets on an already-configured provider must not overwrite
 * the live account's discovery cache.
 */
export function resolveTestDiscoveryAccountId(
  provider: Pick<LlmProviderEntry, 'id' | 'activeAccountId' | 'isConfigured' | 'connectionSchema'>,
  request: Pick<LlmProviderDraftRequest, 'apiKey' | 'connectionValues'> = {},
): string {
  const anonymousId = `anonymous:${provider.id}`;
  const liveAccountId = provider.activeAccountId?.trim() || anonymousId;
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(provider.connectionSchema);
  const hasDraftPrimarySecret = Boolean(request.apiKey?.trim());
  const hasDraftOtherSecret = (provider.connectionSchema?.fields ?? [])
    .filter((field) => field.kind === 'secret' && field.id !== primarySecretFieldId)
    .some((field) => Boolean(request.connectionValues?.[field.id]?.trim()));
  const testingUncommittedSecret = hasDraftPrimarySecret || hasDraftOtherSecret;
  if (testingUncommittedSecret && provider.isConfigured && provider.activeAccountId?.trim()) {
    return anonymousId;
  }
  return liveAccountId;
}
