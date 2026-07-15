import { describe, expect, it } from 'vitest';
import {
  assertSapAiCoreApiUrl,
  buildSapAiCoreDeploymentListUrl,
  createSapAiCoreDestination,
  parseSapAiCoreServiceKey,
} from './SapAiCoreCredentials';

const rawKey = JSON.stringify({
  clientid: 'client-id',
  clientsecret: 'client-secret',
  url: 'https://auth.example.test',
  serviceurls: { AI_API_URL: 'https://api.example.test/v2/' },
});

describe('SAP AI Core credentials', () => {
  it('builds an OAuth destination without mutating process.env', () => {
    const before = process.env.AICORE_SERVICE_KEY;
    const key = parseSapAiCoreServiceKey(rawKey);
    expect(key).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiUrl: 'https://api.example.test/v2',
      tokenServiceUrl: 'https://auth.example.test/oauth/token',
    });
    expect(createSapAiCoreDestination(key)).toMatchObject({
      url: 'https://api.example.test/v2',
      authentication: 'OAuth2ClientCredentials',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    expect(process.env.AICORE_SERVICE_KEY).toBe(before);
  });

  it('fails closed when the visible route does not match the service key endpoint', () => {
    const key = parseSapAiCoreServiceKey(rawKey);
    expect(() => assertSapAiCoreApiUrl(key, 'https://other.example.test/v2')).toThrow(/must match/u);
    expect(buildSapAiCoreDeploymentListUrl(key.apiUrl)).toBe('https://api.example.test/v2/lm/deployments');
  });

  it('rejects incomplete or non-HTTPS service keys', () => {
    expect(() => parseSapAiCoreServiceKey('{}')).toThrow(/must include/u);
    expect(() => parseSapAiCoreServiceKey(JSON.stringify({
      clientid: 'id', clientsecret: 'secret', url: 'http://auth.test',
      serviceurls: { AI_API_URL: 'https://api.test/v2' },
    }))).toThrow(/HTTPS/u);
  });
});
