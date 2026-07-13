import type { ProviderAccountKey } from '@shared/types/providerCapability';

export const DEFAULT_OAUTH_REFRESH_SKEW_MS = 60_000;

export class OAuthRefreshError extends Error {
  readonly code: 'INVALID_GRANT';
  readonly providerId: string;
  readonly accountId: string;

  constructor(key: ProviderAccountKey, cause: unknown) {
    super(`OAuth refresh grant is invalid for ${key.providerId}/${key.accountId}; sign in again.`, { cause });
    this.name = 'OAuthRefreshError';
    this.code = 'INVALID_GRANT';
    this.providerId = key.providerId;
    this.accountId = key.accountId;
  }
}

export interface OAuthRefreshRequest<T> {
  key: ProviderAccountKey;
  current: T;
  expiresAt?: string;
  force?: boolean;
  refreshSkewMs?: number;
  refresh: () => Promise<T>;
  commit: (refreshed: T) => Promise<void> | void;
  onInvalidGrant?: (error: OAuthRefreshError) => Promise<void> | void;
}

function refreshKey(key: ProviderAccountKey): string {
  return `${key.providerId}\u0000${key.accountId}`;
}

function isRefreshDue(expiresAt: string | undefined, nowMs: number, skewMs: number): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= nowMs + skewMs;
}

function isInvalidGrant(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (code === 'invalid_grant' || code === 'INVALID_GRANT') return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\binvalid[_ -]?grant\b/i.test(message);
}

export class OAuthRefreshManager {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  refresh<T>(request: OAuthRefreshRequest<T>): Promise<T> {
    const skewMs = request.refreshSkewMs ?? DEFAULT_OAUTH_REFRESH_SKEW_MS;
    if (!request.force && !isRefreshDue(request.expiresAt, this.now(), skewMs)) {
      return Promise.resolve(request.current);
    }

    const key = refreshKey(request.key);
    const active = this.inFlight.get(key);
    if (active) return active as Promise<T>;

    const operation = (async () => {
      try {
        const refreshed = await request.refresh();
        await request.commit(refreshed);
        return refreshed;
      } catch (error) {
        if (isInvalidGrant(error)) {
          const invalidGrant = new OAuthRefreshError(request.key, error);
          await request.onInvalidGrant?.(invalidGrant);
          throw invalidGrant;
        }
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, operation);
    return operation;
  }
}

export const oauthRefreshManager = new OAuthRefreshManager();
