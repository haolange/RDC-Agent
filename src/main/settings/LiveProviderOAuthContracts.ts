import { createHash, randomBytes } from 'crypto';

export function createPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
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
