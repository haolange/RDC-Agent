import { createHash, randomBytes } from 'crypto';
import { oauthRefreshManager } from './OAuthRefreshManager';

export type MiniMaxRegion = 'global' | 'cn';

export const MINIMAX_REFERENCE = {
  repository: 'NousResearch/hermes-agent',
  revision: 'dfeedf613dcd2ca97d0903ad7fcacad118e39bca',
  path: 'hermes_cli/auth.py',
} as const;

export const MINIMAX_OAUTH_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';
export const MINIMAX_OAUTH_SCOPE = 'group_id profile model.completion';

export function miniMaxRegionContract(region: MiniMaxRegion) {
  const portalBaseUrl = region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
  return {
    region,
    portalBaseUrl,
    inferenceBaseUrl: `${portalBaseUrl}/anthropic`,
    authorizationUrl: `${portalBaseUrl}/oauth/code`,
    tokenUrl: `${portalBaseUrl}/oauth/token`,
  } as const;
}

function form(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

export function createPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildMiniMaxAuthorizationRequest(region: MiniMaxRegion, challenge: string, state: string) {
  const contract = miniMaxRegionContract(region);
  return {
    url: contract.authorizationUrl,
    body: form({
      response_type: 'code', client_id: MINIMAX_OAUTH_CLIENT_ID, scope: MINIMAX_OAUTH_SCOPE,
      code_challenge: challenge, code_challenge_method: 'S256', state,
    }),
  };
}

export function buildMiniMaxTokenPoll(region: MiniMaxRegion, userCode: string, verifier: string) {
  return {
    url: miniMaxRegionContract(region).tokenUrl,
    body: form({
      grant_type: 'urn:ietf:params:oauth:grant-type:user_code', client_id: MINIMAX_OAUTH_CLIENT_ID,
      user_code: userCode, code_verifier: verifier,
    }),
  };
}

export function buildMiniMaxRefresh(region: MiniMaxRegion, refreshToken: string) {
  return {
    url: miniMaxRegionContract(region).tokenUrl,
    body: form({ grant_type: 'refresh_token', client_id: MINIMAX_OAUTH_CLIENT_ID, refresh_token: refreshToken }),
  };
}

export interface MiniMaxOAuthTokens {
  accountId: string;
  region: MiniMaxRegion;
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
}

export async function refreshMiniMaxOAuth(
  current: MiniMaxOAuthTokens,
  exchange: (request: ReturnType<typeof buildMiniMaxRefresh>) => Promise<unknown>,
  commit: (tokens: MiniMaxOAuthTokens) => Promise<void> | void,
  force = false,
): Promise<MiniMaxOAuthTokens> {
  return oauthRefreshManager.refresh({
    key: { providerId: 'minimax-account', accountId: current.accountId },
    current,
    expiresAt: current.expiresAt,
    force,
    refreshSkewMs: 60_000,
    refresh: async () => {
      const payload = await exchange(buildMiniMaxRefresh(current.region, current.refreshToken));
      if (!payload || typeof payload !== 'object') throw new Error('MiniMax OAuth refresh returned an invalid payload.');
      const record = payload as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown };
      if (typeof record.access_token !== 'string' || !record.access_token) {
        const error = new Error('MiniMax OAuth refresh did not return an access token.') as Error & { code?: string };
        if (typeof record.error === 'string') error.code = record.error;
        throw error;
      }
      const ttl = typeof record.expires_in === 'number' && record.expires_in > 0 ? record.expires_in : 900;
      return {
        ...current,
        accessToken: record.access_token,
        refreshToken: typeof record.refresh_token === 'string' && record.refresh_token ? record.refresh_token : current.refreshToken,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    },
    commit,
  });
}

export const OPENROUTER_AUTHORIZE_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

export function buildOpenRouterAuthorizationUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(OPENROUTER_AUTHORIZE_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function buildOpenRouterExchange(code: string, verifier: string) {
  return {
    url: OPENROUTER_EXCHANGE_URL,
    body: { code, code_verifier: verifier, code_challenge_method: 'S256' as const },
  };
}

export function parseOpenRouterExchange(payload: unknown): { apiKey: string; userId?: string } {
  if (!payload || typeof payload !== 'object' || typeof (payload as { key?: unknown }).key !== 'string') {
    throw new Error('OpenRouter PKCE exchange did not return an API key.');
  }
  const value = payload as { key: string; user_id?: unknown };
  return { apiKey: value.key, userId: typeof value.user_id === 'string' ? value.user_id : undefined };
}
