import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import { ProviderAccountAuthService } from './ProviderAccountAuthService';

const GROK_PUBLIC_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';

const mocks = vi.hoisted(() => ({
  savedConnections: [] as Array<{ providerId: string; secretPayload: string; models: unknown[]; accountSummary: unknown }>,
  disconnectedProviders: [] as string[],
  disconnectedAuthModes: [] as Array<string | undefined>,
  oauthSecret: '',
  provider: {
    id: 'grok-account',
    isConfigured: false,
    status: 'unconfigured',
    models: [] as unknown[],
  } as {
    id: string;
    authMode?: string;
    authModeAvailability?: { account?: { state: string; reason?: string } };
    isConfigured: boolean;
    status: string;
    models: unknown[];
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
        authMode: 'account',
        isConfigured: true,
        status: 'verified',
        models,
      };
      return {};
    },
    rotateProviderAccountCredential: () => ({}),
    markProviderAccountRefreshFailure: () => ({}),
    disconnectProvider: (providerId: string, authMode?: string) => {
      mocks.disconnectedProviders.push(providerId);
      mocks.disconnectedAuthModes.push(authMode);
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

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8'),
) as Record<string, unknown>;

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
    mocks.savedConnections.length = 0;
    mocks.disconnectedProviders.length = 0;
    mocks.disconnectedAuthModes.length = 0;
    mocks.oauthSecret = '';
    mocks.provider = {
      id: 'grok-account',
      isConfigured: false,
      status: 'unconfigured',
      models: [] as unknown[],
    };
    vi.restoreAllMocks();
  });

  it('starts Super Grok browser OAuth with the public Grok Build client, PKCE, and fixed loopback redirect', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson(grokMetadata);

    const status = await service.startLogin({ providerId: 'grok-account' });

    expect(status.state).toBe('pending');
    expect(status.authorizationMode).toBe('browser');
    expect(status.redirectUri).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(status.authUrl).toContain('https://auth.x.ai/oauth2/authorize');
    const authUrl = new URL(status.authUrl ?? '');
    expect(authUrl.searchParams.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(authUrl.searchParams.get('scope')).toBe('openid profile email offline_access grok-cli:access api:access');
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
    const publishCatalog = vi.fn(async () => undefined);
    service.setCatalogPublisher(publishCatalog);
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
        models: {
          'grok-4.5': {
            info: {
              id: 'grok-4.5', name: 'Grok 4.5', api_backend: 'responses',
              context_window: 500000, supported_in_api: true,
            },
          },
        },
      },
      {
        data: [{ id: 'grok-4.3', context_window: 1000000 }],
      },
    );

    await service.startLogin({ providerId: 'grok-account' });
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
    expect(tokenBody.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
    expect(tokenBody.get('code')).toBe('auth-code-1');
    expect(tokenBody.get('redirect_uri')).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(tokenBody.get('code_verifier')).toBeTruthy();
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as {
      authorizationMode?: string;
      refreshToken?: string;
      requestedScopes?: string;
      redirectUri?: string;
      accountLabel?: string;
      planLabel?: string;
    };
    expect(bundle.authorizationMode).toBe('browser');
    expect(bundle.refreshToken).toBe('refresh-1');
    expect(bundle.requestedScopes).toBe('openid profile email offline_access grok-cli:access api:access');
    expect(bundle.redirectUri).toBe(SUPER_GROK_OAUTH_REDIRECT_URI);
    expect(bundle.accountLabel).toBe('operator@example.com');
    expect(bundle.planLabel).toBe('Super Grok OAuth');
    expect(mocks.savedConnections[0].models).toEqual([
      { id: 'grok-4.3', label: 'grok-4.3', enabled: true },
      { id: 'grok-4.5', label: 'Grok 4.5', enabled: true },
    ]);
    expect(publishCatalog).toHaveBeenCalledWith('grok-account', expect.objectContaining({
      contributions: expect.arrayContaining([
        expect.objectContaining({
          modelId: 'grok-4.3',
          route: expect.objectContaining({ protocol: 'OpenAICompatibleChatCompletions' }),
        }),
        expect.objectContaining({
          modelId: 'grok-4.5',
          route: expect.objectContaining({ protocol: 'OpenAIResponses' }),
        }),
      ]),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://cli-chat-proxy.grok.com/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-1' }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.x.ai/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-1' }) }),
    );
  });

  it('fails closed on Super Grok callback state mismatch without persisting tokens', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(grokMetadata);

    await service.startLogin({ providerId: 'grok-account' });
    const response = await httpGetText(`${SUPER_GROK_OAUTH_REDIRECT_URI}?state=wrong&code=auth-code`);
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
        models: {
          'grok-4.5': {
            info: {
              id: 'grok-4.5', name: 'Grok 4.5', api_backend: 'responses',
              context_window: 500000, supported_in_api: true,
            },
          },
        },
      },
      {
        data: [{ id: 'grok-4.3', context_window: 1000000 }],
      },
    );

    const status = await service.startLogin({ providerId: 'grok-account', accountLoginMode: 'device' });

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
    expect(deviceBody.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
    expect(deviceBody.get('scope')).toBe('openid profile email offline_access grok-cli:access api:access');
    await vi.waitFor(() => expect(mocks.savedConnections).toHaveLength(1));
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { authorizationMode?: string; refreshToken?: string; accessToken?: string };
    expect(bundle.authorizationMode).toBe('device');
    expect(bundle.refreshToken).toBe('refresh-1');
    expect(bundle.accessToken).toBe('access-1');
  });

  it('surfaces actionable Super Grok device authorization errors', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(
      grokMetadata,
      { payload: { error: 'invalid_request', error_description: 'bad client' }, ok: false, status: 400 },
    );

    const status = await service.startLogin({ providerId: 'grok-account', accountLoginMode: 'device' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('Super Grok OAuth device authorization failed');
    expect(status.diagnostic?.checklist).toContain('Use a SuperGrok or X Premium Plus account with Grok Build access.');
    expect(status.message).toContain('openid profile email offline_access grok-cli:access api:access');
    expect(status.message).toContain('invalid_request');
    expect(status.message).toContain('bad client');
    expect(status.diagnostic?.providerError).toBe('invalid_request');
  });

  it('wraps Super Grok startup network failures with actionable diagnostics', async () => {
    const service = new ProviderAccountAuthService();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')));

    const status = await service.startLogin({ providerId: 'grok-account' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('Super Grok OAuth browser authorization failed');
    expect(status.message).toContain('metadata network access');
    expect(status.message).toContain('fetch failed');
    expect(status.diagnostic?.stage).toBe('authorization');
  });

  it('fails clearly when xAI metadata rejects the required Grok Build scope', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson({
      ...grokMetadata,
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    });

    const status = await service.startLogin({ providerId: 'grok-account' });

    expect(status.state).toBe('failed');
    expect(status.message).toContain('required Grok Build scope');
    expect(status.message).toContain('grok-cli:access');
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

    await service.startLogin({ providerId: 'grok-account', accountLoginMode: 'device' });

    await vi.waitFor(() => expect(service.status('grok-account').state).toBe('failed'));
    expect(service.status('grok-account').error).toContain('Super Grok OAuth device token polling failed');
    expect(service.status('grok-account').error).toContain('access_denied');
    expect(service.status('grok-account').error).toContain('Denied by user');
  });

  it('refreshes expired Super Grok bundles using metadata token endpoint and the public client', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'grok-account',
      isConfigured: true,
      status: 'verified',
      models: [{ id: 'grok-4.5', label: 'Grok 4.5', enabled: true }],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      authorizationMode: 'browser',
      requestedScopes: 'openid profile email offline_access grok-cli:access api:access',
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
        models: {
          'grok-4.5': {
            info: {
              id: 'grok-4.5', name: 'Grok 4.5', api_backend: 'responses',
              context_window: 500000, supported_in_api: true,
            },
          },
        },
      },
      {
        data: [{ id: 'grok-4.3', context_window: 1000000 }],
      },
    );

    const status = await service.test('grok-account');

    expect(status).toMatchObject({ state: 'connected' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.x.ai/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const refreshBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(refreshBody.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
    expect(mocks.savedConnections).toHaveLength(1);
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { accessToken?: string; refreshToken?: string; authorizationMode?: string };
    expect(bundle.accessToken).toBe('new-access');
    expect(bundle.refreshToken).toBe('refresh-2');
    expect(bundle.authorizationMode).toBe('browser');
  });

  it('revokes Super Grok tokens best-effort through metadata before clearing the local account', async () => {
    const service = new ProviderAccountAuthService();
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
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
    const revokeBody = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(revokeBody.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
  });

  it('completes OpenRouter PKCE on a dynamic localhost callback and preserves account-scoped logout', async () => {
    const service = new ProviderAccountAuthService();
    const data = fixture('openrouter-pkce.json');
    mocks.provider = {
      id: 'openrouter',
      authMode: 'api-key',
      authModeAvailability: { account: { state: 'unknown' } },
      isConfigured: false,
      status: 'unconfigured',
      models: [],
    };
    const fetchMock = mockFetchJson(data.exchange, data.models);

    const pending = await service.startLogin({ providerId: 'openrouter', authMode: 'account' });
    expect(pending).toMatchObject({ state: 'pending', authorizationMode: 'browser' });
    expect(pending.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/openrouter\/callback\//u);
    const authUrl = new URL(pending.authUrl ?? '');
    expect(authUrl.origin).toBe('https://openrouter.ai');
    expect(authUrl.searchParams.get('callback_url')).toBe(pending.redirectUri);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const callback = await httpGetText(`${pending.redirectUri}?code=fixture-code`);
    expect(callback).toMatchObject({ statusCode: 200 });
    expect(service.status('openrouter')).toMatchObject({ state: 'connected', connected: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://openrouter.ai/api/v1/auth/keys',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    const saved = mocks.savedConnections.at(-1);
    expect(saved?.providerId).toBe('openrouter');
    expect(JSON.parse(saved?.secretPayload ?? '{}')).toMatchObject({
      providerId: 'openrouter', apiKey: 'sk-or-fixture', accountId: 'fixture-user',
    });
    expect(saved?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'anthropic/claude-sonnet-4.6' }),
    ]));

    service.logout('openrouter');
    expect(mocks.disconnectedProviders.at(-1)).toBe('openrouter');
    expect(mocks.disconnectedAuthModes.at(-1)).toBe('account');
  });

  it('implements the pinned MiniMax CN device flow with regional Anthropic routing', async () => {
    const service = new ProviderAccountAuthService();
    const data = fixture('minimax-oauth.json') as {
      authorization: Record<string, unknown>;
      token: Record<string, unknown>;
    };
    mocks.provider = {
      id: 'minimax-account',
      authMode: 'account',
      authModeAvailability: { account: { state: 'unavailable', reason: 'TODO(live-verify)' } },
      isConfigured: false,
      status: 'unavailable',
      models: [],
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const state = new URLSearchParams(String(init.body)).get('state');
        return jsonResponse({ ...data.authorization, state });
      })
      .mockResolvedValueOnce(jsonResponse(data.token));
    vi.stubGlobal('fetch', fetchMock);

    const pending = await service.startLogin({ providerId: 'minimax-account', accountRegion: 'cn' });
    expect(pending).toMatchObject({ state: 'pending', authorizationMode: 'device', available: false });
    expect(pending.verificationUri).toBe(data.authorization.verification_uri);
    expect(pending.userCode).toBe(data.authorization.user_code);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.minimaxi.com/oauth/code',
      expect.objectContaining({ method: 'POST' }),
    );
    await vi.waitFor(() => expect(mocks.savedConnections.some((entry) => entry.providerId === 'minimax-account')).toBe(true));
    const saved = mocks.savedConnections.find((entry) => entry.providerId === 'minimax-account');
    const bundle = JSON.parse(saved?.secretPayload ?? '{}') as Record<string, unknown>;
    expect(bundle).toMatchObject({
      providerId: 'minimax-account',
      region: 'cn',
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      inferenceBaseUrl: 'https://api.minimaxi.com/anthropic',
    });
    expect(saved?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'MiniMax-M2.7' }),
      expect.objectContaining({ id: 'MiniMax-M2.7-highspeed' }),
    ]));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.minimaxi.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('loads the live ChatGPT Codex catalog and excludes Web-only Pro surfaces', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'chatgpt-account',
      isConfigured: true,
      status: 'verified',
      models: [],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'chatgpt-account',
      accessToken: 'chatgpt-access',
      accountId: 'chatgpt-account-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const fetchMock = mockFetchJson({
      models: [
        {
          slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list', supported_in_api: true,
          input_modalities: ['text', 'image'], context_window: 272000, max_context_window: 1000000,
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'xhigh' }],
        },
        {
          slug: 'gpt-5.6-sol-pro', display_name: 'GPT-5.6 Sol Pro', visibility: 'list',
          supported_in_api: true, context_window: 372000, max_context_window: 372000,
        },
      ],
    });

    const discovery = await service.loadEffectiveCatalog('chatgpt-account');

    expect(discovery.models.map((model) => model.id)).toEqual(['gpt-5.4']);
    expect(discovery.contributions).toEqual([
      expect.objectContaining({
        modelId: 'gpt-5.4',
        defaultBudgetTokens: 272000,
        fast: expect.objectContaining({ kind: 'request-param', entitlement: 'granted' }),
        contextTiers: expect.arrayContaining([
          expect.objectContaining({ id: 'default', maxPromptTokens: 272000, entitlement: 'granted' }),
          expect.objectContaining({ id: 'max', maxPromptTokens: 1000000, entitlement: 'unknown' }),
        ]),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer chatgpt-access',
          'chatgpt-account-id': 'chatgpt-account-1',
        }),
      }),
    );
  });

  it('loads Claude Account models with the Claude Code OAuth identity headers', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'claude-account',
      isConfigured: true,
      status: 'verified',
      models: [],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'claude-account',
      accessToken: 'claude-access',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const fetchMock = mockFetchJson({
      data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }],
    });

    const discovery = await service.loadEffectiveCatalog('claude-account');

    expect(discovery.models).toEqual([{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', enabled: true }]);
    expect(discovery.contributions).toEqual([
      expect.objectContaining({ modelId: 'claude-opus-4-8' }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'claude-access',
          'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
          'x-app': 'cli',
        }),
      }),
    );
  });
});
