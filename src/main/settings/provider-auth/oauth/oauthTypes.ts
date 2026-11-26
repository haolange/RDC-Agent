import { z, type ZodType } from 'zod';
import type { LlmProviderAccountDiagnostic, LlmProviderAccountLoginMode, LlmProviderId } from '@shared/types/settings';

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

/** A stored account credential as the sign-in flows write it. */
export const OAuthSecretBundleSchema: ZodType<OAuthSecretBundle> = z.object({
  providerId: z.string(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  apiKey: z.string().optional(),
  copilotToken: z.string().optional(),
  copilotApiBaseUrl: z.string().optional(),
  copilotModelBilling: z.record(z.string(), z.unknown()).optional(),
  idToken: z.string().optional(),
  authorizationMode: z.enum(['browser', 'device']).optional(),
  requestedScopes: z.string().optional(),
  redirectUri: z.string().optional(),
  accountId: z.string().optional(),
  expiresAt: z.string().optional(),
  accountLabel: z.string().optional(),
  planLabel: z.string().optional(),
  resourceUrl: z.string().optional(),
});

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
