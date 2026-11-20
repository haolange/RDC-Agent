import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountLoginMode,
  LlmProviderId,
} from '@shared/types/settings';

export interface OAuthFlowState {
  providerId: LlmProviderId;
  flowId: string;
  state: string;
  codeVerifier?: string;
  nonce?: string;
  issuer?: string;
  jwksUri?: string;
  abortController?: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
  exchanging?: boolean;
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
  providerId: LlmProviderId;
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
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  revocationEndpoint: string;
  scopesSupported: string[];
  grantTypesSupported: string[];
  codeChallengeMethodsSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
}
