import type { LlmProviderAccountDiagnostic, LlmProviderAccountLoginMode } from '@shared/types/settings';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
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
  'Use a SuperGrok or X Premium Plus account with Grok Build access.',
  'Allow the requested Grok Build and API scopes in the browser.',
  'Copy the one-time code shown by xAI back into RDC Agent before it expires.',
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
  diagnostic.summary,
  diagnostic.requestedScopes ? 'Requested scopes: ' + diagnostic.requestedScopes + '.' : '',
  diagnostic.redirectUri ? 'Redirect URI: ' + diagnostic.redirectUri + '.' : '',
  diagnostic.providerError ? 'Provider error: ' + diagnostic.providerError + '.' : '',
  diagnostic.detail ? 'Detail: ' + diagnostic.detail + '.' : '',
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
    deviceAuthorizationEndpoint: readString(record.device_authorization_endpoint) ?? '',
    tokenEndpoint: readString(record.token_endpoint) ?? '',
    userinfoEndpoint: readString(record.userinfo_endpoint) ?? '',
    revocationEndpoint: readString(record.revocation_endpoint) ?? '',
    scopesSupported: readStringArray(record.scopes_supported),
    grantTypesSupported: readStringArray(record.grant_types_supported),
    codeChallengeMethodsSupported: readStringArray(record.code_challenge_methods_supported),
    tokenEndpointAuthMethodsSupported: readStringArray(record.token_endpoint_auth_methods_supported),
  };
  if (!metadata.authorizationEndpoint || !metadata.deviceAuthorizationEndpoint || !metadata.tokenEndpoint || !metadata.userinfoEndpoint || !metadata.revocationEndpoint) {
    throw new Error('xAI OAuth metadata is missing required browser, device, token, userinfo, or revocation endpoints.');
  }
  if (metadata.grantTypesSupported.length > 0) {
    if (!metadata.grantTypesSupported.includes('authorization_code')) {
      throw new Error('xAI OAuth metadata does not advertise browser authorization-code support.');
    }
    if (!metadata.grantTypesSupported.includes('urn:ietf:params:oauth:grant-type:device_code')) {
      throw new Error('xAI OAuth metadata does not advertise device authorization support.');
    }
  }
  if (metadata.codeChallengeMethodsSupported.length > 0 && !metadata.codeChallengeMethodsSupported.includes('S256')) {
    throw new Error('xAI OAuth metadata does not advertise PKCE S256 support.');
  }
  if (metadata.tokenEndpointAuthMethodsSupported.length > 0 && !metadata.tokenEndpointAuthMethodsSupported.includes('none')) {
    throw new Error('xAI OAuth metadata does not advertise public-client token exchange support.');
  }
  return metadata;
};

export const fetchGrokOAuthMetadata = async (): Promise<GrokOAuthMetadata> => {
  const payload = await fetchJson(GROK_OPENID_CONFIGURATION_URL, {
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

export const SUPER_GROK_OAUTH_REDIRECT = SUPER_GROK_OAUTH_REDIRECT_URI;
