import { generateKeyPairSync, sign } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyGrokIdentity } from './grokIdentity';
import type { OAuthFlowState } from './oauthTypes';

const flow: OAuthFlowState = { providerId: 'grok-account', flowId: 'flow', state: 'state', nonce: 'nonce',
  issuer: 'https://auth.x.ai', jwksUri: 'https://auth.x.ai/.well-known/jwks.json', clientId: 'client', expiresAt: Date.now() + 60000 };
describe('Grok signed identity', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['valid', 'nonce', 'issuer', 'audience', 'expired', 'signature', 'algorithm'])('checks %s', async (caseName) => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const header = { alg: caseName === 'algorithm' ? 'none' : 'ES256', kid: 'key' };
    const claims = { sub: 'account', iss: caseName === 'issuer' ? 'https://other.test' : flow.issuer,
      aud: caseName === 'audience' ? 'other' : flow.clientId, nonce: caseName === 'nonce' ? 'other' : flow.nonce,
      iat: Date.now() / 1000, exp: Date.now() / 1000 + (caseName === 'expired' ? -10 : 600) };
    const body = [header, claims].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = sign('sha256', Buffer.from(body), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
    if (caseName === 'signature') signature[0] ^= 1;
    const token = `${body}.${signature.toString('base64url')}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({
      keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'key' }],
    }) }));
    if (caseName === 'valid') await expect(verifyGrokIdentity(token, flow)).resolves.toBeUndefined();
    else await expect(verifyGrokIdentity(token, flow)).rejects.toThrow();
  });
});
