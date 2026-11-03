/**
 * HAL-compatible credential store contract types.
 *
 * This module is a FORMALIZATION layer only — it defines the interface contracts
 * that future code can target. The actual implementation remains in
 * SecretStorageService and ProviderRuntimeCredentialService.
 */

/** Opaque credential record stored per provider. */
export interface ProviderCredential {
  /** Encrypted or resolved API key value. */
  apiKey?: string;
  /** Optional base URL override associated with the credential. */
  baseUrl?: string;
  /** OAuth token payload (serialized JSON or raw token). */
  oauthToken?: string;
  /** ISO timestamp of last modification. */
  updatedAt?: string;
  /** Arbitrary provider-specific metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Abstract credential store — read/modify/delete credentials keyed by provider ID.
 * Implementations must guarantee atomicity of `modify` (read-transform-write).
 */
export interface CredentialStore {
  read(providerId: string): Promise<ProviderCredential | undefined>;
  modify(
    providerId: string,
    fn: (current: ProviderCredential | undefined) => Promise<ProviderCredential | undefined>,
  ): Promise<ProviderCredential | undefined>;
  delete(providerId: string): Promise<void>;
}

/** API-key based authentication resolver. */
export interface ApiKeyAuth {
  name: string;
  resolve(input: {
    modelId: string;
    providerId: string;
  }): Promise<{ apiKey: string; baseUrl?: string } | undefined>;
}

/** OAuth-based authentication flow. */
export interface OAuthAuth {
  name: string;
  login(callbacks: { signal?: AbortSignal }): Promise<{ token: string }>;
  refresh(credential: { token: string }): Promise<{ token: string }>;
  toAuth(credential: { token: string }): Promise<{ apiKey: string; headers?: Record<string, string> }>;
}

/** Composite provider authentication surface. */
export interface ProviderAuth {
  apiKey?: ApiKeyAuth;
  oauth?: OAuthAuth;
}
