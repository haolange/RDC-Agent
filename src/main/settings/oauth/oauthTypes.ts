import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountLoginMode,
  LlmProviderId,
} from '@shared/types/settings';

export type AccountProviderId =
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot'
  | 'grok-account'
  | 'nous'
  | 'openrouter';

export interface OAuthFlowState {
  providerId: AccountProviderId;
  flowId: string;
  state: string;
  codeVerifier?: string;
  authUrl?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  intervalSeconds?: number;
  clientId?: string;
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  resourceUrl?: string;
  expiresAt: number;
  server?: import('http').Server;
  error?: string;
  diagnostic?: LlmProviderAccountDiagnostic;
}

export interface OAuthSecretBundle {
  providerId: AccountProviderId;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  copilotToken?: string;
  copilotApiBaseUrl?: string;
  copilotModelBilling?: Record<string, unknown>;
  idToken?: string;
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  accountId?: string;
  expiresAt?: string;
  accountLabel?: string;
  planLabel?: string;
  resourceUrl?: string;
}

export interface GrokOAuthMetadata {
  authorizationEndpoint: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  revocationEndpoint: string;
  scopesSupported: string[];
  grantTypesSupported: string[];
  codeChallengeMethodsSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
}

export const isAccountProviderId = (providerId: LlmProviderId): providerId is AccountProviderId =>
  providerId === 'claude-account'
  || providerId === 'chatgpt-account'
  || providerId === 'github-copilot'
  || providerId === 'grok-account'
  || providerId === 'nous'
  || providerId === 'openrouter';
