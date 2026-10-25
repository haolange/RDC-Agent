import { createPublicKey, verify, type JsonWebKey } from 'crypto';
import type { OAuthFlowState } from './oauthTypes';
import { fetchJson, parseJwtPayload } from './oauthHttp';

/** Verify the provider's signed identity, not just a decoded JWT payload. */
export async function verifyGrokIdentity(token: string | undefined, flow: OAuthFlowState): Promise<void> {
  if (!token || !flow.jwksUri || !flow.issuer || !flow.nonce) throw new Error('Grok did not return a verifiable identity token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Grok identity token is malformed.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'ES256' || !header.kid) throw new Error('Grok identity signing algorithm is unsupported.');
  const payload = await fetchJson(flow.jwksUri, { method: 'GET', signal: flow.abortController?.signal }) as { keys?: (JsonWebKey & { kid?: string; use?: string; alg?: string })[] };
  const jwk = payload.keys?.find((key) => key.kid === header.kid && key.kty === 'EC' && key.crv === 'P-256'
    && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'ES256'));
  if (!jwk || !verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), {
    key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
  }, Buffer.from(parts[2], 'base64url'))) throw new Error('Grok identity signature is invalid.');
  const claims = parseJwtPayload(token);
  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  if (!claims || claims.iss !== flow.issuer || !audiences.includes(flow.clientId)
    || (audiences.length > 1 && claims.azp !== flow.clientId) || claims.nonce !== flow.nonce
    || typeof claims.sub !== 'string' || !claims.sub
    || typeof claims.exp !== 'number' || claims.exp <= now
    || typeof claims.iat !== 'number' || claims.iat > now + 60
    || (typeof claims.nbf === 'number' && claims.nbf > now + 60)) {
    throw new Error('Grok identity issuer, audience, nonce or validity did not match this sign-in attempt.');
  }
}
