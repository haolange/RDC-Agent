import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildOpenRouterAuthorizationUrl,
  buildOpenRouterExchange,
  parseOpenRouterExchange,
} from './LiveProviderOAuthContracts';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8')) as Record<string, unknown>;
}

describe('live-verification OAuth contracts', () => {
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
