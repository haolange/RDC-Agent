import { createPublicKey, verify } from 'crypto';
import { z } from 'zod';
import { fetchJson, parseJwtPayload } from './oauthHttp';
import type { OAuthFlowState } from './oauthTypes';

/** The JOSE header fields this check reads; other header fields are allowed. */
const IdentityHeaderSchema = z.object({ alg: z.literal('ES256'), kid: z.string().min(1) }).passthrough();
/** The JWK Set fields this check reads; the key itself is handed to `createPublicKey` as published. */
const JwksSchema = z.object({
  keys: z.array(z.object({
    kid: z.string().optional(), kty: z.string().optional(), crv: z.string().optional(),
    use: z.string().optional(), alg: z.string().optional(),
  }).passthrough()),
}).passthrough();

function parseIdentityHeader(segment: string): z.infer<typeof IdentityHeaderSchema> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('Grok identity token is malformed.', { cause: error });
  }
  const header = IdentityHeaderSchema.safeParse(value);
  if (!header.success) throw new Error('Grok identity signing algorithm is unsupported.');
  return header.data;
}

/** Verify the provider's signed identity, not just a decoded JWT payload. */
export async function verifyGrokIdentity(token: string | undefined, flow: OAuthFlowState): Promise<void> {
  if (!token || !flow.jwksUri || !flow.issuer || !flow.nonce) throw new Error('Grok did not return a verifiable identity token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Grok identity token is malformed.');
  const header = parseIdentityHeader(parts[0]);
  const jwks = JwksSchema.safeParse(await fetchJson(flow.jwksUri, { method: 'GET', signal: flow.abortController?.signal }));
  if (!jwks.success) throw new Error('Grok identity signing keys are malformed.');
  const jwk = jwks.data.keys.find((key) => key.kid === header.kid && key.kty === 'EC' && key.crv === 'P-256'
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
