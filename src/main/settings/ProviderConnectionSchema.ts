import type { LlmProviderConnectionSchema } from '@shared/types/settings';

const TEMPLATE_FIELD_PATTERN = /\$\{([A-Z][A-Z0-9_]*)\}/gu;

export function resolvePrimaryConnectionSecretFieldId(
  schema: LlmProviderConnectionSchema | undefined,
): string | undefined {
  const secretFields = schema?.fields.filter((field) => field.kind === 'secret') ?? [];
  const explicit = schema?.primarySecretFieldId?.trim();
  if (explicit && secretFields.some((field) => field.id === explicit)) {
    return explicit;
  }
  return secretFields.find((field) => field.id === 'apiKey')?.id
    ?? secretFields.find((field) => /(?:BEARER_TOKEN|API_TOKEN|API_KEY|_PAT)$/u.test(field.id))?.id
    ?? secretFields[0]?.id;
}

export function isProviderConnectionSchemaSatisfied(
  schema: LlmProviderConnectionSchema | undefined,
  values: Readonly<Record<string, string>>,
): boolean {
  if (!schema?.fields.length) return true;
  const isPresent = (fieldId: string): boolean => Boolean(values[fieldId]?.trim());
  const alternativeFieldIds = new Set(
    schema.credentialAlternatives?.flatMap((alternative) => alternative.fieldIds) ?? [],
  );
  if (!schema.fields
    .filter((field) => field.required && !alternativeFieldIds.has(field.id))
    .every((field) => isPresent(field.id))) {
    return false;
  }
  return !schema.credentialAlternatives?.length
    || schema.credentialAlternatives.some((alternative) => (
      alternative.ambient === true
      || (alternative.fieldIds.length > 0 && alternative.fieldIds.every(isPresent))
    ));
}

export function resolveProviderEndpointTemplate(
  schema: LlmProviderConnectionSchema | undefined,
  values: Readonly<Record<string, string>>,
  baseUrlDraft: string,
  fallbackBaseUrl: string,
): string {
  const source = baseUrlDraft.trim() || fallbackBaseUrl.trim() || schema?.endpointTemplate?.trim();
  if (!source) return '';
  const missing = new Set<string>();
  const expanded = source.replace(TEMPLATE_FIELD_PATTERN, (_placeholder, fieldId: string, offset: number) => {
    const value = values[fieldId]?.trim();
    if (!value) {
      missing.add(fieldId);
      return '';
    }
    const withoutTrailingSlash = value.replace(/\/+$/u, '');
    return /https?:\/\/$/iu.test(source.slice(0, offset))
      ? withoutTrailingSlash.replace(/^https?:\/\//iu, '')
      : withoutTrailingSlash;
  });
  if (missing.size > 0) {
    throw new Error(`Missing endpoint fields: ${[...missing].join(', ')}`);
  }
  if (/\$\{[^}]+\}/u.test(expanded)) {
    throw new Error('Provider endpoint contains an unsupported template variable.');
  }
  let parsed: URL;
  try {
    parsed = new URL(expanded);
  } catch {
    throw new Error('Provider endpoint must be an absolute HTTP(S) URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider endpoint must use HTTP or HTTPS.');
  }
  return expanded.replace(/\/+$/u, '');
}

export function resolveProviderConnectionHeaders(
  schema: LlmProviderConnectionSchema | undefined,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries((schema?.headerMappings ?? []).flatMap((mapping) => {
    const value = values[mapping.fieldId]?.trim();
    return value ? [[mapping.header, `${mapping.prefix ?? ''}${value}`]] : [];
  }));
}
