import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGoogleCredentialCacheForTests,
  exchangeGoogleCredentialDocument,
  resolveGoogleVertexAccessToken,
} from './GoogleApplicationCredentials';

afterEach(() => {
  clearGoogleCredentialCacheForTests();
  vi.restoreAllMocks();
});

const tokenResponse = () => new Response(JSON.stringify({
  access_token: 'vertex-access-token',
  expires_in: 3600,
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('GoogleApplicationCredentials', () => {
  it('exchanges an authorized-user ADC document without exposing it to renderer settings', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=refresh_token');
      expect(String(init?.body)).toContain('refresh_token=refresh-value');
      return tokenResponse();
    }) as unknown as typeof fetch;

    await expect(exchangeGoogleCredentialDocument({
      type: 'authorized_user',
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-value',
    }, fetchMock)).resolves.toMatchObject({ accessToken: 'vertex-access-token' });
  });

  it('loads an explicit service-account/ADC path and caches only the short-lived access token', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-google-adc-'));
    const credentialPath = path.join(root, 'adc.json');
    await fs.writeFile(credentialPath, JSON.stringify({
      type: 'authorized_user',
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-value',
    }), 'utf8');
    const fetchMock = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    try {
      await expect(resolveGoogleVertexAccessToken(credentialPath, fetchMock)).resolves.toBe('vertex-access-token');
      await expect(resolveGoogleVertexAccessToken(credentialPath, fetchMock)).resolves.toBe('vertex-access-token');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
