import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import type {
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountStatus,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import { settingsService } from './SettingsService';

const REQUEST_TIMEOUT_MS = 20000;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

type AccountProviderId = 'claude-account' | 'chatgpt-account' | 'github-copilot';

interface OAuthFlowState {
  providerId: AccountProviderId;
  flowId: string;
  state: string;
  codeVerifier?: string;
  authUrl?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  intervalSeconds?: number;
  expiresAt: number;
  server?: Server;
  error?: string;
}

interface OAuthSecretBundle {
  providerId: AccountProviderId;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  copilotToken?: string;
  copilotApiBaseUrl?: string;
  expiresAt?: string;
  accountLabel?: string;
  planLabel?: string;
}

const pendingFlows = new Map<string, OAuthFlowState>();

const isAccountProviderId = (providerId: LlmProviderId): providerId is AccountProviderId =>
  providerId === 'claude-account' || providerId === 'chatgpt-account' || providerId === 'github-copilot';

const isTestMode = (): boolean => process.env.RDC_AGENT_TEST_MODE === '1';

const base64Url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const createPkce = (): { verifier: string; challenge: string } => {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const appendParams = (baseUrl: string, params: Record<string, string>): string => {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const normalizeAccountModels = (values: unknown[]): LlmProviderModel[] => {
  const models = new Map<string, LlmProviderModel>();
  for (const value of values) {
    const record = value && typeof value === 'object' ? value as { id?: unknown; name?: unknown; display_name?: unknown } : null;
    const id = typeof value === 'string'
      ? value.trim()
      : typeof record?.id === 'string'
        ? record.id.trim()
        : typeof record?.name === 'string'
          ? record.name.trim()
          : '';
    if (!id || !isAgentRoutableAccountModel(id) || models.has(id)) {
      continue;
    }
    models.set(id, {
      id,
      label: typeof record?.display_name === 'string' && record.display_name.trim() ? record.display_name.trim() : id,
      enabled: true,
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
};

const isAgentRoutableAccountModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return !(
    normalized.includes('embedding')
    || normalized.includes('moderation')
    || normalized.includes('rerank')
    || normalized.includes('whisper')
    || normalized.includes('tts')
    || normalized.includes('dall-e')
    || normalized.includes('image')
    || normalized.includes('audio')
    || normalized.includes('realtime')
    || normalized.includes('transcribe')
  );
};

const parseProviderError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Connection test timed out.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Provider connection failed.';
};

const isExpiringSoon = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return false;
  }
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 60_000;
};

const canRefreshBundle = (bundle: OAuthSecretBundle): boolean =>
  Boolean(bundle.refreshToken || (bundle.providerId === 'github-copilot' && bundle.accessToken));

const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const parseModels = (payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const data = (payload as { data?: unknown; models?: unknown }).data ?? (payload as { data?: unknown; models?: unknown }).models;
  return Array.isArray(data) ? normalizeAccountModels(data) : [];
};

export class ProviderAccountAuthService {
  async startLogin(providerId: LlmProviderId): Promise<LlmProviderAccountStatus> {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, 'Provider does not support account login.');
    }
    if (providerId === 'claude-account') {
      return this.startClaudeLogin();
    }
    if (providerId === 'chatgpt-account') {
      return this.startChatGptLogin();
    }
    return this.startGitHubCopilotLogin();
  }

  async finishLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    if (!isAccountProviderId(request.providerId)) {
      return this.status(request.providerId, 'Provider does not support account login.');
    }
    const flow = this.findFlow(request.providerId, request.flowId);
    if (!flow) {
      return this.status(request.providerId, 'Login flow expired or was not started.', 'failed');
    }

    try {
      if (request.providerId === 'claude-account') {
        const bundle = await this.exchangeClaudeCode(flow, request.code?.trim() ?? '');
        return this.persistAccount(request.providerId, bundle);
      }
      if (request.providerId === 'chatgpt-account') {
        const bundle = await this.exchangeChatGptCode(flow, request.code?.trim() ?? '');
        return this.persistAccount(request.providerId, bundle);
      }
      const bundle = await this.pollGitHubDevice(flow);
      return this.persistAccount(request.providerId, bundle);
    } catch (error) {
      flow.error = parseProviderError(error);
      return this.status(request.providerId, flow.error, 'failed');
    }
  }

  async test(providerId: LlmProviderId): Promise<LlmProviderAccountStatus> {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, 'Provider does not support account login.');
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      return this.status(providerId, 'Account is not connected.');
    }
    try {
      const activeBundle = await this.refreshBundleIfNeeded(bundle);
      const models = await this.discoverModels(activeBundle);
      if (models.length === 0) {
        throw new Error('Account provider returned no usable models.');
      }
      settingsService.saveProviderAccountConnection(
        providerId,
        JSON.stringify(activeBundle),
        models,
        {
          accountLabel: activeBundle.accountLabel,
          planLabel: activeBundle.planLabel,
          oauthExpiresAt: activeBundle.expiresAt,
          oauthRefreshAvailable: canRefreshBundle(activeBundle),
        },
      );
      return this.status(providerId);
    } catch (error) {
      return this.status(providerId, parseProviderError(error), 'failed');
    }
  }

  status(providerId: LlmProviderId, message?: string, forcedState?: LlmProviderAccountStatus['state']): LlmProviderAccountStatus {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const isAccount = isAccountProviderId(providerId);
    const flow = isAccount ? this.findFlow(providerId) : null;
    const connected = Boolean(provider?.isConfigured && provider.status === 'verified');
    const state: LlmProviderAccountStatus['state'] = forcedState
      ?? (flow?.error ? 'failed' : flow ? 'pending' : connected ? 'connected' : isAccount ? 'signed-out' : 'unavailable');
    return {
      providerId,
      state,
      available: isAccount,
      connected,
      message: message ?? flow?.error ?? (connected ? 'Connected' : flow ? 'Waiting for authorization.' : 'Not connected'),
      error: forcedState === 'failed' ? message : flow?.error,
      accountLabel: provider?.accountLabel,
      planLabel: provider?.planLabel,
      expiresAt: provider?.oauthExpiresAt,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow?.providerId === 'claude-account' || (isTestMode() && flow?.providerId === 'chatgpt-account')),
      models: provider?.models ?? [],
    };
  }

  logout(providerId: LlmProviderId): LlmProviderAccountStatus {
    if (isAccountProviderId(providerId)) {
      this.clearFlows(providerId);
      settingsService.disconnectProvider(providerId);
    }
    return this.status(providerId);
  }

  private startClaudeLogin(): LlmProviderAccountStatus {
    const { verifier, challenge } = createPkce();
    const state = randomUUID();
    const flow: OAuthFlowState = {
      providerId: 'claude-account',
      flowId: randomUUID(),
      state,
      codeVerifier: verifier,
      authUrl: appendParams('https://claude.ai/oauth/authorize', {
        code: 'true',
        client_id: CLAUDE_CLIENT_ID,
        response_type: 'code',
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        scope: 'org:create_api_key user:profile user:inference',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.setFlow(flow);
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }

  private startChatGptLogin(): LlmProviderAccountStatus {
    const { verifier, challenge } = createPkce();
    const state = randomUUID();
    const flow: OAuthFlowState = {
      providerId: 'chatgpt-account',
      flowId: randomUUID(),
      state,
      codeVerifier: verifier,
      authUrl: appendParams('https://auth.openai.com/oauth/authorize', {
        client_id: CHATGPT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        scope: 'openid profile email offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        codex_cli_simplified_flow: 'true',
        id_token_add_organizations: 'true',
      }),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.setFlow(flow);
    if (!isTestMode()) {
      this.startChatGptCallbackServer(flow);
    }
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }

  private async startGitHubCopilotLogin(): Promise<LlmProviderAccountStatus> {
    const payload = await fetchJson('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        scope: 'read:user',
      }),
    }) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
    };
    const flow: OAuthFlowState = {
      providerId: 'github-copilot',
      flowId: randomUUID(),
      state: randomUUID(),
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      intervalSeconds: payload.interval ?? 5,
      expiresAt: Date.now() + (payload.expires_in ?? 900) * 1000,
    };
    this.setFlow(flow);
    if (flow.verificationUri) {
      void this.openExternal(flow.verificationUri);
    }
    void this.pollGitHubDevice(flow)
      .then((bundle) => this.persistAccount('github-copilot', bundle))
      .catch((error) => {
        flow.error = parseProviderError(error);
      });
    return this.status(flow.providerId);
  }

  private async exchangeClaudeCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
    if (!code || !flow.codeVerifier) {
      throw new Error('Authorization code is required.');
    }
    const payload = await fetchJson('https://platform.claude.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'RDC-Agent',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLAUDE_CLIENT_ID,
        code,
        redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
        code_verifier: flow.codeVerifier,
        state: flow.state,
      }),
    }) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!payload.access_token) {
      throw new Error('Claude OAuth did not return an access token.');
    }
    return {
      providerId: 'claude-account',
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      accountLabel: 'Claude Account',
      planLabel: payload.scope,
    };
  }

  private async exchangeChatGptCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
    if (!code || !flow.codeVerifier) {
      throw new Error('Authorization code is required.');
    }
    const tokenPayload = await fetchJson('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CHATGPT_CLIENT_ID,
        code,
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        code_verifier: flow.codeVerifier,
      }).toString(),
    }) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
    let apiKey = tokenPayload.access_token;
    if (tokenPayload.id_token) {
      try {
        const exchangePayload = await fetchJson('https://auth.openai.com/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            client_id: CHATGPT_CLIENT_ID,
            subject_token: tokenPayload.id_token,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
            requested_token: 'openai-api-key',
          }).toString(),
        }) as { access_token?: string };
        apiKey = exchangePayload.access_token ?? apiKey;
      } catch {
        // Access token fallback still lets Test surface a clear provider error.
      }
    }
    if (!apiKey) {
      throw new Error('OpenAI OAuth did not return a usable credential.');
    }
    return {
      providerId: 'chatgpt-account',
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      apiKey,
      expiresAt: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1000).toISOString(),
      accountLabel: 'ChatGPT Account',
    };
  }

  private async pollGitHubDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
    if (!flow.deviceCode) {
      throw new Error('GitHub device code is missing.');
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    for (;;) {
      if (Date.now() > flow.expiresAt) {
        throw new Error('GitHub authorization code expired.');
      }
      if (!isTestMode()) {
        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      }
      const payload = await fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      }) as { access_token?: string; error?: string; interval?: number };
      if (payload.error === 'authorization_pending') {
        if (isTestMode()) {
          throw new Error('GitHub authorization is still pending.');
        }
        continue;
      }
      if (payload.error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (!payload.access_token) {
        throw new Error('GitHub OAuth did not return an access token.');
      }
      const copilot = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `token ${payload.access_token}`,
          'Editor-Version': 'RDC-Agent/1.0',
          'Editor-Plugin-Version': 'RDC-Agent/1.0',
        },
      }) as { token?: string; expires_at?: number; endpoints?: { api?: string } };
      if (!copilot.token) {
        throw new Error('GitHub Copilot did not return an API token.');
      }
      return {
        providerId: 'github-copilot',
        accessToken: payload.access_token,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? 'https://api.githubcopilot.com',
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1000).toISOString() : undefined,
        accountLabel: 'GitHub Copilot',
      };
    }
  }

  private async persistAccount(providerId: AccountProviderId, bundle: OAuthSecretBundle): Promise<LlmProviderAccountStatus> {
    const models = await this.discoverModels(bundle);
    if (models.length === 0) {
      throw new Error('Account provider returned no usable models.');
    }
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(bundle),
      models,
      {
        accountLabel: bundle.accountLabel,
        planLabel: bundle.planLabel,
        oauthExpiresAt: bundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(bundle),
      },
    );
    this.clearFlows(providerId);
    return this.status(providerId);
  }

  private async refreshBundleIfNeeded(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
    if (!isExpiringSoon(bundle.expiresAt)) {
      return bundle;
    }

    if (bundle.providerId === 'github-copilot') {
      if (!bundle.accessToken) {
        return bundle;
      }
      const copilot = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `token ${bundle.accessToken}`,
          'Editor-Version': 'RDC-Agent/1.0',
          'Editor-Plugin-Version': 'RDC-Agent/1.0',
        },
      }) as { token?: string; expires_at?: number; endpoints?: { api?: string } };
      if (!copilot.token) {
        throw new Error('GitHub Copilot did not return an API token.');
      }
      return {
        ...bundle,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com',
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1000).toISOString() : bundle.expiresAt,
      };
    }

    if (!bundle.refreshToken) {
      return bundle;
    }

    if (bundle.providerId === 'claude-account') {
      const payload = await fetchJson('https://platform.claude.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RDC-Agent',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: CLAUDE_CLIENT_ID,
          refresh_token: bundle.refreshToken,
        }),
      }) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
      if (!payload.access_token) {
        throw new Error('Claude OAuth refresh did not return an access token.');
      }
      return {
        ...bundle,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? bundle.refreshToken,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
        planLabel: payload.scope ?? bundle.planLabel,
      };
    }

    const payload = await fetchJson('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CHATGPT_CLIENT_ID,
        refresh_token: bundle.refreshToken,
      }).toString(),
    }) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new Error('OpenAI OAuth refresh did not return an access token.');
    }
    return {
      ...bundle,
      accessToken: payload.access_token,
      apiKey: payload.access_token,
      refreshToken: payload.refresh_token ?? bundle.refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  private async discoverModels(bundle: OAuthSecretBundle): Promise<LlmProviderModel[]> {
    if (bundle.providerId === 'claude-account') {
      const payload = await fetchJson('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bundle.accessToken}`,
          'anthropic-version': '2023-06-01',
        },
      });
      return parseModels(payload);
    }
    if (bundle.providerId === 'github-copilot') {
      const baseUrl = (bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com').replace(/\/+$/, '');
      const payload = await fetchJson(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bundle.copilotToken}`,
          'Content-Type': 'application/json',
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Version': 'RDC-Agent/1.0',
          'Editor-Plugin-Version': 'RDC-Agent/1.0',
        },
      });
      return parseModels(payload);
    }
    const payload = await fetchJson('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bundle.apiKey ?? bundle.accessToken}`,
      },
    });
    return parseModels(payload);
  }

  private readBundle(providerId: AccountProviderId): OAuthSecretBundle | null {
    const raw = settingsService.getProviderOAuthSecret(providerId);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as OAuthSecretBundle;
      return parsed.providerId === providerId ? parsed : null;
    } catch {
      return null;
    }
  }

  private findFlow(providerId: AccountProviderId, flowId?: string): OAuthFlowState | null {
    for (const flow of pendingFlows.values()) {
      if (flow.providerId === providerId && (!flowId || flow.flowId === flowId) && Date.now() <= flow.expiresAt) {
        return flow;
      }
    }
    return null;
  }

  private setFlow(flow: OAuthFlowState): void {
    this.clearFlows(flow.providerId);
    pendingFlows.set(flow.flowId, flow);
  }

  private clearFlows(providerId: AccountProviderId): void {
    for (const [flowId, flow] of pendingFlows.entries()) {
      if (flow.providerId === providerId) {
        flow.server?.close();
        pendingFlows.delete(flowId);
      }
    }
  }

  private startChatGptCallbackServer(flow: OAuthFlowState): void {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://localhost:${CHATGPT_CALLBACK_PORT}`);
      if (url.pathname !== '/auth/callback' || url.searchParams.get('state') !== flow.state) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Invalid OAuth callback.');
        return;
      }
      const code = url.searchParams.get('code') ?? '';
      void this.finishLogin({ providerId: flow.providerId, flowId: flow.flowId, code })
        .then(() => {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end('<html><body>RDC Agent sign-in complete. You can return to the app.</body></html>');
        })
        .catch((error) => {
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end(parseProviderError(error));
        });
    });
    server.on('error', (error) => {
      flow.error = parseProviderError(error);
    });
    server.listen(CHATGPT_CALLBACK_PORT, '127.0.0.1');
    flow.server = server;
  }

  private async openExternal(url?: string): Promise<void> {
    if (!url || isTestMode()) {
      return;
    }
    await shell.openExternal(url);
  }
}

export const providerAccountAuthService = new ProviderAccountAuthService();
