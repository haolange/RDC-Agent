import type { LlmProviderAccountDiagnostic, LlmProviderAccountLoginMode } from '@shared/types/settings';
import type { GrokOAuthMetadata } from './oauthTypes';
import {
  GROK_OAUTH_REQUESTED_SCOPES,
  GROK_OPENID_CONFIGURATION_URL,
} from './oauthConstants';
import {
  fetchJson,
  parseProviderError,
  readString,
  readStringArray,
} from './oauthHttp';

export const readOAuthError = (payload: unknown): { error?: string; detail?: string } => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    error: readString(record.error),
    detail: readString(record.error_description) ?? readString(record.message),
  };
};

const SUPER_GROK_OAUTH_CHECKLIST = [
  'Use an xAI account with Grok Build access.',
  'Allow the requested Grok Build and API scopes in the browser.',
  'Complete sign-in in your browser and return to RDC Agent.',
];

export const createGrokOAuthDiagnostic = (
  stage: LlmProviderAccountDiagnostic['stage'],
  summary: string,
  options: Partial<Omit<LlmProviderAccountDiagnostic, 'stage' | 'summary'>> = {},
): LlmProviderAccountDiagnostic => ({
  stage,
  summary,
  detail: options.detail,
  providerError: options.providerError,
  requestedScopes: options.requestedScopes,
  redirectUri: options.redirectUri,
  checklist: options.checklist ?? SUPER_GROK_OAUTH_CHECKLIST,
});

export const renderGrokOAuthDiagnosticMessage = (diagnostic: LlmProviderAccountDiagnostic): string => [
  diagnostic.summary, diagnostic.detail,
].filter(Boolean).join(' ');

export const createGrokOAuthFailureDiagnostic = (
  stage: LlmProviderAccountDiagnostic['stage'],
  operation: string,
  payload: unknown,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => {
  const { error, detail } = readOAuthError(payload);
  return createGrokOAuthDiagnostic(
    stage,
    'Super Grok OAuth ' + operation + ' failed. Check the xAI public OAuth Client ID, redirect URI, and allowed scopes.',
    {
      providerError: error || parseProviderError(payload),
      detail,
      requestedScopes: scope,
      redirectUri,
    },
  );
};

export class GrokOAuthDiagnosticError extends Error {
  constructor(readonly diagnostic: LlmProviderAccountDiagnostic) {
    super(renderGrokOAuthDiagnosticMessage(diagnostic));
  }
}

export const createGrokOAuthStartupDiagnostic = (
  error: unknown,
  mode: LlmProviderAccountLoginMode,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => {
  const message = parseProviderError(error);
  const stage: LlmProviderAccountDiagnostic['stage'] = message.startsWith('xAI OAuth metadata') ? 'metadata' : 'authorization';
  if (message.startsWith('Super Grok OAuth ') || message.startsWith('xAI OAuth metadata')) {
    return createGrokOAuthDiagnostic(stage, message, { requestedScopes: scope, redirectUri });
  }
  return createGrokOAuthDiagnostic(
    stage,
    'Super Grok OAuth ' + mode + ' authorization failed. Check the xAI public OAuth Client ID, xAI OAuth metadata network access, redirect URI, and allowed scopes.',
    { detail: message, requestedScopes: scope, redirectUri },
  );
};

export const resolveGrokOAuthDiagnostic = (
  error: unknown,
  mode: LlmProviderAccountLoginMode,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => (
  error instanceof GrokOAuthDiagnosticError
    ? error.diagnostic
    : createGrokOAuthStartupDiagnostic(error, mode, scope, redirectUri)
);

const parseGrokOAuthMetadata = (payload: unknown): GrokOAuthMetadata => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const metadata: GrokOAuthMetadata = {
    authorizationEndpoint: readString(record.authorization_endpoint) ?? '',
    issuer: readString(record.issuer) ?? '',
    jwksUri: readString(record.jwks_uri) ?? '',
    tokenEndpoint: readString(record.token_endpoint) ?? '',
    userinfoEndpoint: readString(record.userinfo_endpoint) ?? '',
    revocationEndpoint: readString(record.revocation_endpoint) ?? '',
    scopesSupported: readStringArray(record.scopes_supported),
    grantTypesSupported: readStringArray(record.grant_types_supported),
    codeChallengeMethodsSupported: readStringArray(record.code_challenge_methods_supported),
    tokenEndpointAuthMethodsSupported: readStringArray(record.token_endpoint_auth_methods_supported),
  };
  if (!metadata.authorizationEndpoint || !metadata.tokenEndpoint || !metadata.userinfoEndpoint || !metadata.revocationEndpoint) {
    throw new Error('xAI OAuth metadata is missing required browser, token, userinfo, or revocation endpoints.');
  }
  if (metadata.grantTypesSupported.length > 0) {
    if (!metadata.grantTypesSupported.includes('authorization_code')) {
      throw new Error('xAI OAuth metadata does not advertise browser authorization-code support.');
    }
  }
  if (metadata.codeChallengeMethodsSupported.length > 0 && !metadata.codeChallengeMethodsSupported.includes('S256')) {
    throw new Error('xAI OAuth metadata does not advertise PKCE S256 support.');
  }
  if (metadata.tokenEndpointAuthMethodsSupported.length > 0 && !metadata.tokenEndpointAuthMethodsSupported.includes('none')) {
    throw new Error('xAI OAuth metadata does not advertise public-client token exchange support.');
  }
  if (metadata.issuer !== 'https://auth.x.ai' || !metadata.jwksUri
    || [metadata.authorizationEndpoint, metadata.tokenEndpoint, metadata.userinfoEndpoint,
      metadata.revocationEndpoint, metadata.jwksUri].some((endpoint) => new URL(endpoint).origin !== metadata.issuer)) {
    throw new Error('xAI OAuth metadata contains an untrusted issuer or endpoint.');
  }
  return metadata;
};

export const fetchGrokOAuthMetadata = async (signal?: AbortSignal): Promise<GrokOAuthMetadata> => {
  const payload = await fetchJson(GROK_OPENID_CONFIGURATION_URL, {
    signal,
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return parseGrokOAuthMetadata(payload);
};

export const resolveGrokOAuthScope = (metadata: GrokOAuthMetadata): string => {
  const supported = new Set(metadata.scopesSupported);
  const requested = GROK_OAUTH_REQUESTED_SCOPES.filter((scope) => (
    supported.size === 0 || supported.has(scope)
  ));
  const missing = GROK_OAUTH_REQUESTED_SCOPES.filter((scope) => (
    supported.size > 0 && !supported.has(scope)
  ));
  if (requested.length === 0 || missing.includes('grok-cli:access')) {
    throw new Error(
      'xAI OAuth metadata does not support the required Grok Build scope. Missing scopes: '
      + (missing.join(', ') || 'unknown')
      + '.',
    );
  }
  return requested.join(' ');
};
