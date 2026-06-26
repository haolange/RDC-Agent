import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      return {};
    },
    disconnectProvider: (providerId: string) => {
      mocks.disconnectedProviders.push(providerId);
      return {};
    },
  },
}));

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

describe('ProviderAccountAuthService Grok OAuth', () => {
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

  it('fails closed when Grok OAuth client id is missing', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson();

    const status = await service.startLogin({ providerId: 'grok-account' });

    expect(status.state).toBe('failed');
    expect(status.requiresClientId).toBe(true);
    expect(status.message).toContain('client id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts Grok device flow and persists successful token polling with client id', async () => {
    const service = new ProviderAccountAuthService();
    const fetchMock = mockFetchJson(
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

    const status = await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });

    expect(status.state).toBe('pending');
    expect(status.verificationUri).toBe('https://auth.x.ai/activate');
    expect(status.authUrl).toBe('https://auth.x.ai/activate?user_code=ABCD-EFGH');
    expect(status.userCode).toBe('ABCD-EFGH');
    await vi.waitFor(() => expect(mocks.savedConnections).toHaveLength(1));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://auth.x.ai/oauth2/device/code',
      expect.objectContaining({ method: 'POST' }),
    );
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { clientId?: string; refreshToken?: string; accessToken?: string };
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.refreshToken).toBe('refresh-1');
    expect(bundle.accessToken).toBe('access-1');
    expect(mocks.savedConnections[0].models).toEqual([{ id: 'grok-code-fast-1', label: 'grok-code-fast-1', enabled: true }]);
  });

  it('surfaces Grok token polling errors on the pending flow', async () => {
    const service = new ProviderAccountAuthService();
    mockFetchJson(
      {
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.x.ai/activate',
        expires_in: 600,
      },
      { payload: { error: 'access_denied', error_description: 'Denied by user' }, ok: false, status: 400 },
    );

    await service.startLogin({ providerId: 'grok-account', oauthClientId: 'client-1' });

    await vi.waitFor(() => expect(service.status('grok-account').state).toBe('failed'));
    expect(service.status('grok-account').error).toBe('Denied by user');
  });

  it('refreshes expired Grok bundles using the stored client id', async () => {
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
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    mockFetchJson(
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
    expect(mocks.savedConnections).toHaveLength(1);
    const bundle = JSON.parse(mocks.savedConnections[0].secretPayload) as { accessToken?: string; refreshToken?: string; clientId?: string };
    expect(bundle.accessToken).toBe('new-access');
    expect(bundle.refreshToken).toBe('refresh-2');
    expect(bundle.clientId).toBe('client-1');
  });

  it('revokes Grok tokens best-effort on logout before clearing the local account', async () => {
    const service = new ProviderAccountAuthService();
    mocks.oauthSecret = JSON.stringify({
      providerId: 'grok-account',
      clientId: 'client-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    const fetchMock = mockFetchJson({});

    const status = service.logout('grok-account');

    expect(status.state).toBe('signed-out');
    expect(mocks.disconnectedProviders).toEqual(['grok-account']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.x.ai/oauth2/revoke',
      expect.objectContaining({ method: 'POST' }),
    ));
  });
});