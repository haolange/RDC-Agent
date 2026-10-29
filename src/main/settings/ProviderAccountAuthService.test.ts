import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getProviderModelDefinitions } from '../provider-catalog/ProviderCatalogRegistry';
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
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
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
  issuer: 'https://auth.x.ai',
  jwks_uri: 'https://auth.x.ai/.well-known/jwks.json',
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

describe('ProviderAccountAuthService Grok sign-in', () => {
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

  it('uses one dynamic callback, matching state and PKCE without manual completion', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(grokMetadata);
    try {
      const status = await service.startLogin({ providerId: 'grok-account' });
      expect(status).toMatchObject({ state: 'pending', authorizationMode: 'browser', requiresCodeInput: false });
      expect(status.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const authorization = new URL(status.authUrl!);
      expect(authorization.searchParams.get('redirect_uri')).toBe(status.redirectUri);
      expect(authorization.searchParams.get('client_id')).toBe(GROK_PUBLIC_CLIENT_ID);
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorization.searchParams.get('nonce')).toBeTruthy();
      expect((await httpGetText(`${status.redirectUri}?code=wrong&state=wrong`)).statusCode).toBe(400);
      expect(mocks.savedConnections).toHaveLength(0);
      expect((await service.finishLogin({ providerId: 'grok-account', code: 'manual' })).connected).toBe(false);
    } finally { service.dispose(); }
  });

  it('does not launch an operating-system browser in headless verification', async () => {
    const { shell } = await import('electron');
    const service = new ProviderAccountAuthService();
    mockFetchJson(grokMetadata);
    process.env.RDC_AGENT_HEADLESS = '1';
    delete process.env.RDC_AGENT_TEST_MODE;
    try {
      expect((await service.startLogin({ providerId: 'grok-account' })).state).toBe('pending');
      expect(shell.openExternal).not.toHaveBeenCalled();
    } finally { service.dispose(); delete process.env.RDC_AGENT_HEADLESS; process.env.RDC_AGENT_TEST_MODE = '1'; }
  });

  it('opens Grok in the system default browser and reports launch failures without leaving a callback', async () => {
    const { shell } = await import('electron');
    const service = new ProviderAccountAuthService();
    delete process.env.RDC_AGENT_TEST_MODE;
    mockFetchJson(grokMetadata);
    try {
      const status = await service.startLogin({ providerId: 'grok-account' });
      expect(shell.openExternal).toHaveBeenCalledWith(status.authUrl);
      expect(status.state).toBe('pending');
      service.cancelLogin('grok-account');
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('Default browser launch failed'));
      mockFetchJson(grokMetadata);
      const failed = await service.startLogin({ providerId: 'grok-account' });
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('Default browser launch failed');
      const flows = (service as unknown as { pendingFlows: Map<string, { abortController: AbortController; server?: http.Server }> }).pendingFlows;
      expect([...flows.values()][0].abortController.signal.aborted).toBe(true);
    } finally { service.dispose(); process.env.RDC_AGENT_TEST_MODE = '1'; }
  });

  it('does not let a replaced login startup failure mark the new attempt failed', async () => {
    const service = new ProviderAccountAuthService(); let rejectOld!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(jsonResponse(grokMetadata)));
    const old = service.startLogin({ providerId: 'grok-account' });
    try {
      const current = await service.startLogin({ providerId: 'grok-account' });
      expect(current.state).toBe('pending');
      rejectOld(new Error('cancelled earlier metadata'));
      await old;
      expect(service.status('grok-account')).toMatchObject({ state: 'pending', authUrl: current.authUrl });
    } finally { service.dispose(); }
  });

  function signedToken(nonce: string): { token: string; key: unknown } {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: grokMetadata.issuer, aud: GROK_PUBLIC_CLIENT_ID,
      sub: 'account', nonce, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600 })).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { token: `${header}.${payload}.${signature}`, key: { ...keys.publicKey.export({ format: 'jwk' }), kid: 'key' } };
  }

  it.each([false, true])('validates identity and never persists a cancelled exchange (cancel=%s)', async (cancel) => {
    const service = new ProviderAccountAuthService();
    const publish = vi.fn(async () => undefined);
    service.setCatalogPublisher(publish);
    mockFetchJson(grokMetadata);
    const status = await service.startLogin({ providerId: 'grok-account' });
    const url = new URL(status.authUrl!);
    const signed = signedToken(url.searchParams.get('nonce')!);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/token')) {
        if (cancel) await gate;
        return jsonResponse({ access_token: 'access', id_token: signed.token, expires_in: 3600 });
      }
      if (input.endsWith('jwks.json')) return jsonResponse({ keys: [signed.key] });
      if (input.endsWith('/userinfo')) return jsonResponse({ sub: 'account' });
      if (input.endsWith('/models')) return jsonResponse(fixture('grok-builder.json'));
      throw new Error('Unexpected endpoint: ' + input);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const callback = httpGetText(`${status.redirectUri}?code=code&state=${url.searchParams.get('state')}`);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      if (cancel) service.cancelLogin('grok-account');
      release?.();
      const result = await callback;
      expect(result.statusCode).toBe(cancel ? 400 : 200);
      expect(mocks.savedConnections).toHaveLength(cancel ? 0 : 1);
      if (!cancel) {
        expect(publish).toHaveBeenCalledOnce();
        expect(JSON.parse(mocks.savedConnections[0].secretPayload)).not.toHaveProperty('planLabel');
        expect(mocks.savedConnections[0].accountSummary).not.toHaveProperty('planLabel', expect.any(String));
        expect(fetchMock).toHaveBeenCalledWith('https://cli-chat-proxy.grok.com/v1/models',
          expect.objectContaining({ headers: expect.objectContaining({ 'X-XAI-Token-Auth': 'xai-grok-cli' }) }));
      }
      expect(fetchMock.mock.calls.some(([endpoint]) => endpoint.startsWith('https://api.x.ai'))).toBe(false);
    } finally { release?.(); service.dispose(); }
  });

  it('rejects device mode and incompatible or unreachable metadata with an actionable failure', async () => {
    const service = new ProviderAccountAuthService();
    expect((await service.startLogin({ providerId: 'grok-account', accountLoginMode: 'device' })).state).toBe('failed');
    mockFetchJson({ ...grokMetadata, scopes_supported: ['openid'] });
    expect((await service.startLogin({ providerId: 'grok-account' })).error).toContain('scope');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
    expect((await service.startLogin({ providerId: 'grok-account' })).error).toContain('Network unavailable');
    service.dispose();
  });

  it('does not use the public API as a subscription catalog fallback', async () => {
    const service = new ProviderAccountAuthService();
    mocks.oauthSecret = JSON.stringify({ providerId: 'grok-account', accessToken: 'access', expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const fetchMock = vi.fn().mockRejectedValue(new Error('HTTP 403'));
    vi.stubGlobal('fetch', fetchMock);
    expect((await service.test('grok-account')).state).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cli-chat-proxy.grok.com/v1/models');
    expect(mocks.savedConnections).toHaveLength(0);
  });

  it('replaces a pending flow and closes both superseded and disposed listeners', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(grokMetadata, grokMetadata);
    const first = await service.startLogin({ providerId: 'grok-account' });
    const second = await service.startLogin({ providerId: 'grok-account' });
    expect(first.redirectUri).not.toBe(second.redirectUri);
    await expect(httpGetText(first.redirectUri!)).rejects.toThrow();
    service.dispose();
    await expect(httpGetText(second.redirectUri!)).rejects.toThrow();
    expect(mocks.disconnectedProviders).toHaveLength(0);
  });

  it('refreshes expired Grok subscription bundles using metadata token endpoint and the public client', async () => {
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
      redirectUri: 'http://127.0.0.1:12345/callback',
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

  it('does not report a failed live catalog refresh as connected', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'grok-account',
      isConfigured: true,
      status: 'verified',
      models: [{ id: 'grok-4.5', label: 'Grok 4.5', enabled: true }],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
      accessToken: 'access-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const status = await service.test('grok-account');

    expect(status).toMatchObject({
      state: 'failed',
      connected: false,
    });
    expect(status.error).toContain('fetch failed');
  });

  it('revokes Grok subscription tokens best-effort through metadata before clearing the local account', async () => {
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
        contextTiers: expect.arrayContaining([
          expect.objectContaining({ id: 'default', maxPromptTokens: 272000, entitlement: 'granted' }),
          expect.objectContaining({ id: 'max', maxPromptTokens: 1000000, entitlement: 'unknown' }),
        ]),
      }),
    ]);
    expect(discovery.contributions?.[0]).not.toHaveProperty('controls');
    expect(discovery.contributions?.[0]).not.toHaveProperty('executionBindings');
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

  it('keeps Copilot execution variants available to planning without exposing them in the picker', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'github-copilot',
      isConfigured: true,
      status: 'verified',
      models: [],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'github-copilot',
      accessToken: 'github-access',
      copilotToken: 'copilot-token',
      copilotApiBaseUrl: 'https://api.githubcopilot.com',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const copilotFixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'fixtures', 'copilot-models.json'), 'utf8'),
    ) as unknown;
    const fetchMock = mockFetchJson(copilotFixture);

    const discovery = await service.loadEffectiveCatalog('github-copilot');

    expect(discovery.models.map((model) => model.id)).toContain('claude-opus-4.8');
    expect(discovery.contributions?.find((entry) => entry.modelId === 'claude-opus-4.8'))
      .not.toHaveProperty('executionBindings');
    expect(discovery.contributions?.find((entry) => entry.modelId === 'claude-opus-4.8-fast'))
      .not.toHaveProperty('selection');
    const catalogModels = getProviderModelDefinitions('github-copilot');
    expect(catalogModels.find((entry) => entry.modelId === 'claude-opus-4.8')).toMatchObject({
      controls: { fast: { state: 'unsupported' } },
    });
    expect(catalogModels.find((entry) => entry.modelId === 'claude-opus-4.8')?.executionBindings ?? [])
      .toEqual([]);
    expect(catalogModels.find((entry) => entry.modelId === 'claude-opus-4.8-fast')).toMatchObject({
      selection: { pickerVisibility: 'primary' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer copilot-token' }),
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

  it('runs the pinned Nous Portal device flow and discovers the live account catalog', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'nous',
      isConfigured: false,
      status: 'unconfigured',
      models: [],
    };
    const fetchMock = mockFetchJson(
      {
        device_code: 'nous-device-1',
        user_code: 'NOUS-CODE',
        verification_uri: 'https://portal.nousresearch.com/activate',
        verification_uri_complete: 'https://portal.nousresearch.com/activate?code=NOUS-CODE',
        expires_in: 600,
        interval: 1,
      },
      {
        access_token: 'nous-access-1',
        refresh_token: 'nous-refresh-1',
        expires_in: 3600,
        scope: 'inference:invoke',
        inference_base_url: 'https://inference-api.nousresearch.com/v1',
      },
      {
        data: [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
          { id: 'hermes-4-405b', name: 'Hermes 4' },
        ],
      },
    );

    const status = await service.startLogin({ providerId: 'nous', accountLoginMode: 'device' });

    expect(status).toMatchObject({
      state: 'pending',
      authorizationMode: 'device',
      verificationUri: 'https://portal.nousresearch.com/activate',
      userCode: 'NOUS-CODE',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://portal.nousresearch.com/api/oauth/device/code',
      expect.objectContaining({ method: 'POST' }),
    );
    const deviceBody = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(deviceBody.get('client_id')).toBe('hermes-cli');
    expect(deviceBody.get('scope')).toBe('inference:invoke');
    await vi.waitFor(() => expect(mocks.savedConnections).toHaveLength(1));
    expect(mocks.savedConnections[0].providerId).toBe('nous');
    expect(mocks.savedConnections[0].models).toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', enabled: true },
    ]);
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as Record<string, unknown>;
    expect(bundle).toMatchObject({
      providerId: 'nous',
      accessToken: 'nous-access-1',
      refreshToken: 'nous-refresh-1',
      resourceUrl: 'https://inference-api.nousresearch.com/v1',
    });
  });

  it('refreshes a Nous Portal token with the rotating refresh-token header', async () => {
    const service = new ProviderAccountAuthService();
    mocks.provider = {
      id: 'nous',
      isConfigured: true,
      status: 'verified',
      models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', enabled: true }],
    };
    mocks.oauthSecret = JSON.stringify({
      providerId: 'nous',
      accessToken: 'nous-access-old',
      refreshToken: 'nous-refresh-old',
      resourceUrl: 'https://inference-api.nousresearch.com/v1',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const fetchMock = mockFetchJson(
      {
        access_token: 'nous-access-new',
        refresh_token: 'nous-refresh-new',
        expires_in: 3600,
      },
      { data: [{ id: 'claude-sonnet-4-6' }] },
    );

    const status = await service.test('nous');

    expect(status.state).toBe('connected');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://portal.nousresearch.com/api/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-nous-refresh-token': 'nous-refresh-old' }),
      }),
    );
    expect(JSON.parse(mocks.savedConnections[0].secretPayload)).toMatchObject({
      accessToken: 'nous-access-new',
      refreshToken: 'nous-refresh-new',
    });
  });
});
