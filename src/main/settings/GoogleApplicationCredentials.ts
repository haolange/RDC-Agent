import { createSign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface GoogleServiceAccountCredential {
  type: 'service_account';
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface GoogleAuthorizedUserCredential {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_uri?: string;
}

type GoogleCredentialDocument = GoogleServiceAccountCredential | GoogleAuthorizedUserCredential;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

const encodeJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function requireToken(payload: GoogleTokenResponse, source: string): CachedToken {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) throw new Error(`${source} did not return a Google access token.`);
  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : 3600;
  return { accessToken, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
}

async function postTokenForm(
  url: string,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<CachedToken> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed with HTTP ${response.status}.`);
  return requireToken(await response.json() as GoogleTokenResponse, 'Google OAuth');
}

export async function exchangeGoogleCredentialDocument(
  credential: GoogleCredentialDocument,
  fetchImpl: typeof fetch = fetch,
): Promise<CachedToken> {
  const tokenUri = credential.token_uri?.trim() || DEFAULT_TOKEN_URI;
  if (credential.type === 'authorized_user') {
    return postTokenForm(tokenUri, new URLSearchParams({
      client_id: credential.client_id,
      client_secret: credential.client_secret,
      refresh_token: credential.refresh_token,
      grant_type: 'refresh_token',
    }), fetchImpl);
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
    iss: credential.client_email,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credential.private_key, 'base64url')}`;
  return postTokenForm(tokenUri, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }), fetchImpl);
}

function defaultCredentialPaths(): string[] {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const appData = process.env.APPDATA?.trim();
  return [
    configured,
    appData ? path.join(appData, 'gcloud', 'application_default_credentials.json') : '',
    path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'),
  ].filter((entry): entry is string => Boolean(entry));
}

async function readCredential(pathname: string): Promise<GoogleCredentialDocument | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(pathname, 'utf8')) as Partial<GoogleCredentialDocument>;
    if (parsed.type === 'service_account'
      && typeof parsed.client_email === 'string'
      && typeof parsed.private_key === 'string') {
      return parsed as GoogleServiceAccountCredential;
    }
    if (parsed.type === 'authorized_user'
      && typeof parsed.client_id === 'string'
      && typeof parsed.client_secret === 'string'
      && typeof parsed.refresh_token === 'string') {
      return parsed as GoogleAuthorizedUserCredential;
    }
    throw new Error('Unsupported Google application credential document type.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function metadataAccessToken(fetchImpl: typeof fetch): Promise<CachedToken> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetchImpl(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google metadata credential lookup failed with HTTP ${response.status}.`);
    return requireToken(await response.json() as GoogleTokenResponse, 'Google metadata server');
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveGoogleVertexAccessToken(
  explicitCredentialPath?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const candidates = explicitCredentialPath?.trim()
    ? [explicitCredentialPath.trim()]
    : defaultCredentialPaths();
  for (const pathname of candidates) {
    const cacheKey = `file:${path.resolve(pathname)}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.accessToken;
    const credential = await readCredential(pathname);
    if (!credential) continue;
    const token = await exchangeGoogleCredentialDocument(credential, fetchImpl);
    tokenCache.set(cacheKey, token);
    return token.accessToken;
  }

  const cacheKey = 'metadata:default';
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.accessToken;
  try {
    const token = await metadataAccessToken(fetchImpl);
    tokenCache.set(cacheKey, token);
    return token.accessToken;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Google Application Default Credentials are unavailable. ${detail}`);
  }
}

export function clearGoogleCredentialCacheForTests(): void {
  tokenCache.clear();
}
