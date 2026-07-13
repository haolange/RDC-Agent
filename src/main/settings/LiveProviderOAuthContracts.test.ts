import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  MINIMAX_OAUTH_CLIENT_ID,
  MINIMAX_REFERENCE,
  buildMiniMaxAuthorizationRequest,
  buildMiniMaxRefresh,
  buildMiniMaxTokenPoll,
  buildOpenRouterAuthorizationUrl,
  buildOpenRouterExchange,
  miniMaxRegionContract,
  parseOpenRouterExchange,
  refreshMiniMaxOAuth,
} from './LiveProviderOAuthContracts';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8')) as Record<string, unknown>;
}

describe('live-verification OAuth contracts', () => {
  it('pins the MiniMax reference and builds global/CN PKCE device requests', () => {
    expect(MINIMAX_REFERENCE.revision).toMatch(/^[0-9a-f]{40}$/u);
    expect(miniMaxRegionContract('global').inferenceBaseUrl).toBe('https://api.minimax.io/anthropic');
    expect(miniMaxRegionContract('cn').inferenceBaseUrl).toBe('https://api.minimaxi.com/anthropic');
    const authorization = buildMiniMaxAuthorizationRequest('global', 'challenge', 'state');
    expect(authorization.url).toBe('https://api.minimax.io/oauth/code');
    expect(authorization.body.get('client_id')).toBe(MINIMAX_OAUTH_CLIENT_ID);
    expect(authorization.body.get('code_challenge_method')).toBe('S256');
    expect(buildMiniMaxTokenPoll('cn', 'ABCD', 'verifier').body.get('grant_type')).toContain('user_code');
    expect(buildMiniMaxRefresh('cn', 'refresh').body.get('refresh_token')).toBe('refresh');
    expect(fixture('minimax-oauth.json')).toHaveProperty('token');
  });

  it('refreshes MiniMax through the generic account-keyed single-flight manager', async () => {
    let exchanges = 0;
    const current = { accountId: 'account-1', region: 'global' as const, accessToken: 'old', refreshToken: 'refresh', expiresAt: new Date(0).toISOString() };
    const exchange = async () => {
      exchanges += 1;
      await Promise.resolve();
      return { access_token: 'new', refresh_token: 'rotated', expires_in: 900 };
    };
    const commits: string[] = [];
    const [left, right] = await Promise.all([
      refreshMiniMaxOAuth(current, exchange, (tokens) => { commits.push(tokens.refreshToken); }, true),
      refreshMiniMaxOAuth(current, exchange, (tokens) => { commits.push(tokens.refreshToken); }, true),
    ]);
    expect(exchanges).toBe(1);
    expect(commits).toEqual(['rotated']);
    expect(left).toEqual(right);
  });

  it('builds OpenRouter localhost PKCE and stores the exchange as an API key', () => {
    const data = fixture('openrouter-pkce.json');
    const callbackUrl = String(data.callback_url);
    const authorization = new URL(buildOpenRouterAuthorizationUrl(callbackUrl, 'challenge'));
    expect(authorization.searchParams.get('callback_url')).toBe(callbackUrl);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(buildOpenRouterExchange('code', 'verifier')).toMatchObject({
      url: 'https://openrouter.ai/api/v1/auth/keys',
      body: { code: 'code', code_verifier: 'verifier', code_challenge_method: 'S256' },
    });
    expect(parseOpenRouterExchange(data.exchange)).toEqual({ apiKey: 'sk-or-fixture', userId: 'fixture-user' });
  });
});
