import http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import { getProviderSeedModels } from './ProviderPresetRegistry';
import { ProviderAccountAuthService } from './ProviderAccountAuthService';

const mocks = vi.hoisted(() => ({
  savedConnections: [] as Array<{ providerId: string; secretPayload: string; models: unknown[]; accountSummary: unknown }>,
  disconnectedProviders: [] as string[],
  oauthSecret: '',
  provider: {
    id: 'grok-account',
    isConfigured: false,
    status: 'unconfigured',
    models: [] as unknown[],
  },
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('./SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      llm: {
        providers: [mocks.provider],
      },
    }),
    getProviderOAuthSecret: () => mocks.oauthSecret,
    saveProviderAccountConnection: (providerId: string, secretPayload: string, models: unknown[], accountSummary: unknown) => {
      mocks.savedConnections.push({ providerId, secretPayload, models, accountSummary });
      mocks.provider = {
        ...mocks.provider,
        isConfigured: true,
        status: 'verified',
        models,
      };
      return {};
    },
    rotateProviderAccountCredential: () => ({}),
    markProviderAccountRefreshFailure: () => ({}),
    disconnectProvider: (providerId: string) => {
      mocks.disconnectedProviders.push(providerId);
      mocks.provider = {
        ...mocks.provider,
        isConfigured: false,
        status: 'unconfigured',
        models: [],
      };
      return {};
    },
  },
}));

const grokMetadata = {
  authorization_endpoint: 'https://auth.x.ai/oauth2/authorize',
  device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
  token_endpoint: 'https://auth.x.ai/oauth2/token',
  userinfo_endpoint: 'https://auth.x.ai/oauth2/userinfo',
  revocation_endpoint: 'https://auth.x.ai/oauth2/revoke',
  scopes_supported: ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'],
  grant_types_supported: [
    'authorization_code',
    'refresh_token',
    'urn:ietf:params:oauth:grant-type:device_code',
  ],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};

const jsonResponse = (payload: unknown, ok = true, status = ok ? 200 : 400): Response => ({
  ok,
  status,
  text: async () => JSON.stringify(payload),
} as Response);

const mockFetchJson = (...payloads: Array<unknown | { payload: unknown; ok?: boolean; status?: number }>) => {
  const fetchMock = vi.fn();
  for (const item of payloads) {
    const record = item && typeof item === 'object' && 'payload' in item
      ? item as { payload: unknown; ok?: boolean; status?: number }
      : { payload: item };
    fetchMock.mockResolvedValueOnce(jsonResponse(record.payload, record.ok ?? true, record.status));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const httpGetText = (url: string): Promise<{ statusCode: number; body: string }> => new Promise((resolve, reject) => {
  http.get(url, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
  }).on('error', reject);
});

describe('ProviderAccountAuthService Super Grok OAuth', () => {
  beforeEach(() => {
    process.env.RDC_AGENT_TEST_MODE = '1';
    delete process.env.RDC_AGENT_GROK_OAUTH_CLIENT_ID;
    delete process.env.GROK_OAUTH_CLIENT_ID;
    delete process.env.XAI_OAUTH_CLIENT_ID;
    mocks.savedConnections.length = 0;
    mocks.disconnectedProviders.length = 0;
    mocks.oauthSecret = '';
    mocks.provider = {
      id: 'grok-account',
      isConfigured: false,
      status: 'unconfigured',
      models: [] as unknown[],
    };
    vi.restoreAllMocks();
  });

  it('fails closed when Super Grok OAuth client id is missing', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson();

    const status = await service.startLogin({ providerId: 'grok-account' });

    expect(status.state).toBe('failed');
    expect(status.requiresClientId).toBe(true);
    expect(status.message).toContain('public OAuth Client ID');
    expect(status.message).toContain('not an xAI API key');
    expect(status.diagnostic?.stage).toBe('configuration');
    expect(status.redirectUri).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts Super Grok browser OAuth from OIDC metadata with PKCE and loopback redirect', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson(grokMetadata);

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });

    expect(status.state).toBe('pending');
    expect(status.authorizationMode).toBe('browser');
    expect(status.redirectUri).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(status.authUrl).toContain('https://auth.x.ai/oauth2/authorize');
    const authUrl = new URL(status.authUrl ?? '');
    expect(authUrl.searchParams.get('client_id')).toBe('client-1');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email offline_access api:access');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('state')).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://auth.x.ai/.well-known/openid-configuration',
      expect.objectContaining({ method: 'GET' }),
    );

    service.logout('grok-account');
  });

  it('exchanges Super Grok browser authorization code and persists account models', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson(
      grokMetadata,
      {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: 'id-1',
        expires_in: 3600,
      },
      {
        sub: 'acct-1',
        email: 'operator@example.com',
      },
      {
        data: [{ id: 'grok-code-fast-1' }],
      },
    );

    await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });
    const status = await service.finishLogin({ providerId: 'grok-account', code: 'auth-code-1' });

    expect(status.state).toBe('connected');
    expect(mocks.savedConnections).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.x.ai/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const tokenBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(tokenBody.get('grant_type')).toBe('authorization_code');
    expect(tokenBody.get('client_id')).toBe('client-1');
    expect(tokenBody.get('code')).toBe('auth-code-1');
    expect(tokenBody.get('redirect_uri')).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(tokenBody.get('code_verifier')).toBeTruthy();
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as {
      authorizationMode?: string;
      clientId?: string;
      refreshToken?: string;
      requestedScopes?: string;
      redirectUri?: string;
      accountLabel?: string;
      planLabel?: string;
    };
    expect(bundle.authorizationMode).toBe('browser');
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.refreshToken).toBe('refresh-1');
    expect(bundle.requestedScopes).toBe('openid profile email offline_access api:access');
    expect(bundle.redirectUri).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(bundle.accountLabel).toBe('operator@example.com');
    expect(bundle.planLabel).toBe('Super Grok OAuth');
    expect(mocks.savedConnections[0].models).toEqual(getProviderSeedModels('grok-account'));
  });

  it('fails closed on Super Grok callback state mismatch without persisting tokens', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(grokMetadata);

    await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });
    const response = await httpGetText('http://127.0.0.1:1456/oauth/grok/callback?state=wrong&code=auth-code');
    const status = service.status('grok-account');

    expect(response.statusCode).toBe(400);
    expect(status.state).toBe('failed');
    expect(status.diagnostic?.stage).toBe('callback');
    expect(status.message).toContain('state did not match');
    expect(mocks.savedConnections).toHaveLength(0);
  });

  it('starts Super Grok device flow from OIDC metadata and persists successful token polling', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson(
      grokMetadata,
      {
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.x.ai/activate',
        verification_uri_complete: 'https://auth.x.ai/activate?user_code=ABCD-EFGH',
        interval: 1,
        expires_in: 600,
      },
      {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: 'id-1',
        expires_in: 3600,
      },
      {
        sub: 'acct-1',
        email: 'operator@example.com',
      },
      {
        data: [{ id: 'grok-code-fast-1' }],
      },
    );

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1', accountLoginMode: 'device' });

    expect(status.state).toBe('pending');
    expect(status.authorizationMode).toBe('device');
    expect(status.verificationUri).toBe('https://auth.x.ai/activate');
    expect(status.authUrl).toBe('https://auth.x.ai/activate?user_code=ABCD-EFGH');
    expect(status.userCode).toBe('ABCD-EFGH');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.x.ai/oauth2/device/code',
      expect.objectContaining({ method: 'POST' }),
    );
    const deviceBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(deviceBody.get('client_id')).toBe('client-1');
    expect(deviceBody.get('scope')).toBe('openid profile email offline_access api:access');
    await vi.waitFor(() => expect(mocks.savedConnections).toHaveLength(1));
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { authorizationMode?: string; clientId?: string; refreshToken?: string; accessToken?: string };
    expect(bundle.authorizationMode).toBe('device');
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.refreshToken).toBe('refresh-1');
    expect(bundle.accessToken).toBe('access-1');
  });

  it('surfaces actionable Super Grok device authorization errors', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(
      grokMetadata,
      { payload: { error: 'invalid_request', error_description: 'bad client' }, ok: false, status: 400 },
    );

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1', accountLoginMode: 'device' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('Super Grok OAuth device authorization failed');
    expect(status.message).toContain('public OAuth Client ID');
    expect(status.message).toContain('openid profile email offline_access api:access');
    expect(status.message).toContain('invalid_request');
    expect(status.message).toContain('bad client');
    expect(status.diagnostic?.providerError).toBe('invalid_request');
  });

  it('wraps Super Grok startup network failures with actionable diagnostics', async () => {
    const service = new ProviderAccountAuthService();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')));

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('Super Grok OAuth browser authorization failed');
    expect(status.message).toContain('public OAuth Client ID');
    expect(status.message).toContain('metadata network access');
    expect(status.message).toContain('fetch failed');
    expect(status.diagnostic?.stage).toBe('authorization');
  });

  it('fails clearly when xAI metadata rejects the required API scope', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson({
      ...grokMetadata,
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    });

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('required API scope');
    expect(status.message).toContain('api:access');
  });

  it('surfaces Super Grok token polling errors on the pending device flow', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(
      grokMetadata,
      {
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.x.ai/activate',
        expires_in: 600,
      },
      { payload: { error: 'access_denied', error_description: 'Denied by user' }, ok: false, status: 400 },
    );

    await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1', accountLoginMode: 'device' });

    await vi.waitFor(() => expect(service.status('grok-account').state).toBe('failed'));
    expect(service.status('grok-account').error).toContain('Super Grok OAuth device token polling failed');
    expect(service.status('grok-account').error).toContain('access_denied');
    expect(service.status('grok-account').error).toContain('Denied by user');
  });

  it('refreshes expired Super Grok bundles using metadata token endpoint and stored client id', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'grok-account',
      isConfigured: true,
      status: 'verified',
      models: [{ id: 'grok-code-fast-1', label: 'grok-code-fast-1', enabled: true }],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
      clientId: 'client-1',
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      authorizationMode: 'browser',
      requestedScopes: 'openid profile email offline_access api:access',
      redirectUri: SUPER_GROK_OAUTH_REDIRECT_URI,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const fetchMock = mockFetchJson(
      grokMetadata,
      {
        access_token: 'new-access',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      },
      {
        data: [{ id: 'grok-4' }],
      },
    );

    const status = await service.test('grok-account');

    expect(status).toMatchObject({ state: 'connected' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.x.ai/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mocks.savedConnections).toHaveLength(1);
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { accessToken?: string; refreshToken?: string; clientId?: string; authorizationMode?: string };
    expect(bundle.accessToken).toBe('new-access');
    expect(bundle.refreshToken).toBe('refresh-2');
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.authorizationMode).toBe('browser');
  });

  it('revokes Super Grok tokens best-effort through metadata before clearing the local account', async () => {
    const service = new ProviderAccountAuthService();
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
      clientId: 'client-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    const fetchMock = mockFetchJson(grokMetadata, {});

    const status = service.logout('grok-account');

    expect(status.state).toBe('signed-out');
    expect(mocks.disconnectedProviders).toEqual(['grok-account']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.x.ai/oauth2/revoke',
      expect.objectContaining({ method: 'POST' }),
    ));
  });
});
