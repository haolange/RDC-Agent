import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import type {
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import { getBuiltinProviderDefinition } from '@shared/constants/llm';
import { COPILOT_EDITOR_HEADERS, COPILOT_WIRE_HEADERS } from './CopilotWire';
import { settingsService } from './SettingsService';

const REQUEST_TIMEOUT_MS = 20000;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GROK_AUTH_DEVICE_ENDPOINT = 'https://auth.x.ai/oauth2/device/code';
const GROK_AUTH_TOKEN_ENDPOINT = 'https://auth.x.ai/oauth2/token';
const GROK_AUTH_USERINFO_ENDPOINT = 'https://auth.x.ai/oauth2/userinfo';
const GROK_AUTH_REVOKE_ENDPOINT = 'https://auth.x.ai/oauth2/revoke';
const GROK_API_BASE_URL = 'https://api.x.ai/v1';
const GROK_OAUTH_SCOPE = 'openid profile email offline_access api:access';
const GROK_OAUTH_CLIENT_ID_ENV_KEYS = [
  'RDC_AGENT_GROK_OAUTH_CLIENT_ID',
  'GROK_OAUTH_CLIENT_ID',
  'XAI_OAUTH_CLIENT_ID',
] as const;

type AccountProviderId =
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot'
  | 'grok-account'
  | 'gemini-account'
  | 'qwen-account';

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
  clientId?: string;
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
  idToken?: string;
  clientId?: string;
  accountId?: string;
  expiresAt?: string;
  accountLabel?: string;
  planLabel?: string;
}

const pendingFlows = new Map<string, OAuthFlowState>();

const isAccountProviderId = (providerId: LlmProviderId): providerId is AccountProviderId =>
  providerId === 'claude-account'
  || providerId === 'chatgpt-account'
  || providerId === 'github-copilot'
  || providerId === 'grok-account'
  || providerId === 'gemini-account'
  || providerId === 'qwen-account';

const isUnimplementedAccountProviderId = (providerId: AccountProviderId): boolean =>
  providerId === 'gemini-account' || providerId === 'qwen-account';

const resolveGrokOAuthClientId = (draft?: string): { clientId?: string; source?: 'draft' | 'env' } => {
  const cleanDraft = draft?.trim();
  if (cleanDraft) {
    return { clientId: cleanDraft, source: 'draft' };
  }
  for (const key of GROK_OAUTH_CLIENT_ID_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return { clientId: value, source: 'env' };
    }
  }
  return {};
};

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

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseJwtPayload = (token?: string): Record<string, unknown> | null => {
  const payload = token?.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const extractChatGptAccountId = (idToken?: string): string | undefined => {
  const claims = parseJwtPayload(idToken);
  if (!claims) {
    return undefined;
  }

  const authClaim = claims['https://api.openai.com/auth'];
  const authRecord = authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)
    ? authClaim as Record<string, unknown>
    : {};
  const organizations = Array.isArray(claims.organizations) ? claims.organizations : [];
  const firstOrganization = organizations[0] && typeof organizations[0] === 'object'
    ? organizations[0] as Record<string, unknown>
    : {};

  return readString(authRecord.chatgpt_account_id)
    ?? readString(authRecord.account_id)
    ?? readString(claims['https://api.openai.com/auth.chatgpt_account_id'])
    ?? readString(claims.chatgpt_account_id)
    ?? readString(claims.account_id)
    ?? readString(firstOrganization.id);
};

const createAccountCatalogModels = (providerId: AccountProviderId): LlmProviderModel[] => {
  const definition = getBuiltinProviderDefinition(providerId);
  const seen = new Set<string>();
  return (definition?.recommendedModels ?? [])
    .map((modelId) => modelId.trim())
    .filter((modelId) => {
      if (!modelId || seen.has(modelId) || !isAgentRoutableAccountModel(modelId)) {
        return false;
      }
      seen.add(modelId);
      return true;
    })
    .map((modelId) => ({
      id: modelId,
      label: modelId,
      enabled: true,
    }));
};

const mergeAccountModels = (...groups: LlmProviderModel[][]): LlmProviderModel[] => {
  const models = new Map<string, LlmProviderModel>();
  for (const group of groups) {
    for (const model of group) {
      if (!models.has(model.id) && isAgentRoutableAccountModel(model.id)) {
        models.set(model.id, model);
      }
    }
  }
  return Array.from(models.values());
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

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const canRefreshBundle = (bundle: OAuthSecretBundle): boolean => {
  if (bundle.providerId === 'grok-account') {
    return Boolean(bundle.refreshToken && bundle.clientId);
  }
  return Boolean(bundle.refreshToken || (bundle.providerId === 'github-copilot' && bundle.accessToken));
};

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

const fetchOAuthJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok && !(payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string')) {
      throw new Error(`HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};

const createFormBody = (params: Record<string, string>): string => new URLSearchParams(params).toString();

const parseModels = (payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const data = (payload as { data?: unknown; models?: unknown }).data ?? (payload as { data?: unknown; models?: unknown }).models;
  return Array.isArray(data) ? normalizeAccountModels(data) : [];
};

const parseCopilotModels = (payload: unknown): LlmProviderModel[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const data = (payload as { data?: unknown; models?: unknown }).data ?? (payload as { data?: unknown; models?: unknown }).models;
  if (!Array.isArray(data)) {
    return [];
  }
  return normalizeAccountModels(data.filter((value) => {
    const record = value && typeof value === 'object' ? value as { policy?: unknown } : null;
    const policy = record?.policy && typeof record.policy === 'object' && !Array.isArray(record.policy)
      ? record.policy as { state?: unknown }
      : null;
    const state = typeof policy?.state === 'string' ? policy.state.toLowerCase() : '';
    return !state || state === 'enabled';
  }));
};

export class ProviderAccountAuthService {
  async startLogin(request: LlmProviderAccountLoginStartRequest): Promise<LlmProviderAccountStatus> {
    const providerId = request.providerId;
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, 'Provider does not support account login.');
    }
    if (providerId === 'claude-account') {
      return this.startClaudeLogin();
    }
    if (providerId === 'chatgpt-account') {
      return this.startChatGptLogin();
    }
    if (providerId === 'github-copilot') {
      return this.startGitHubCopilotLogin();
    }
    if (providerId === 'grok-account') {
      return this.startGrokLogin(request.oauthClientId);
    }
    return this.startUnimplementedAccountLogin(providerId);
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
        return await this.persistAccount(request.providerId, bundle);
      }
      if (request.providerId === 'chatgpt-account') {
        const bundle = await this.exchangeChatGptCode(flow, request.code?.trim() ?? '');
        return await this.persistAccount(request.providerId, bundle);
      }
      if (isUnimplementedAccountProviderId(request.providerId)) {
        const bundle = this.exchangeUnimplementedAccountCode(flow, request.code?.trim() ?? '');
        return await this.persistAccount(request.providerId, bundle);
      }
      if (request.providerId === 'github-copilot') {
        const bundle = await this.pollGitHubDevice(flow);
        return await this.persistAccount(request.providerId, bundle);
      }
      if (request.providerId === 'grok-account') {
        const bundle = await this.pollGrokDevice(flow);
        return await this.persistAccount(request.providerId, bundle);
      }
      return this.status(request.providerId, 'Provider does not support account login.', 'failed');
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

  async ensureRuntimeCredentials(providerId: LlmProviderId): Promise<void> {
    if (!isAccountProviderId(providerId)) {
      return;
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error('Account is not connected.');
    }
    if (providerId === 'github-copilot' && !bundle.accessToken) {
      throw new Error('GitHub Copilot account access token is missing. Sign in again.');
    }

    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    if (JSON.stringify(activeBundle) === JSON.stringify(bundle)) {
      return;
    }

    const models = await this.discoverModels(activeBundle);
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
  }

  status(providerId: LlmProviderId, message?: string, forcedState?: LlmProviderAccountStatus['state']): LlmProviderAccountStatus {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const isAccount = isAccountProviderId(providerId);
    const flow = isAccount ? this.findFlow(providerId) : null;
    const connected = Boolean(provider?.isConfigured && provider.status === 'verified');
    const grokClientIdSource = providerId === 'grok-account'
      ? flow?.clientId
        ? 'draft'
        : connected && this.readBundle('grok-account')?.clientId
          ? 'stored'
          : resolveGrokOAuthClientId().source
      : undefined;
    const state: LlmProviderAccountStatus['state'] = forcedState
      ?? (connected ? 'connected' : flow?.error ? 'failed' : flow ? 'pending' : isAccount ? 'signed-out' : 'unavailable');
    const pendingMessage = providerId === 'github-copilot'
      ? 'Waiting for GitHub authorization.'
      : providerId === 'grok-account'
        ? 'Waiting for xAI authorization.'
        : 'Waiting for authorization.';
    return {
      providerId,
      state,
      available: isAccount,
      connected,
      message: message ?? flow?.error ?? (connected ? 'Connected' : flow ? pendingMessage : 'Not connected'),
      error: forcedState === 'failed' ? message : flow?.error,
      accountLabel: provider?.accountLabel,
      planLabel: provider?.planLabel,
      expiresAt: provider?.oauthExpiresAt,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow?.providerId === 'claude-account' || (flow && isUnimplementedAccountProviderId(flow.providerId))),
      requiresClientId: providerId === 'grok-account' && !connected && !grokClientIdSource,
      clientIdSource: grokClientIdSource,
      models: provider?.models ?? [],
    };
  }

  logout(providerId: LlmProviderId): LlmProviderAccountStatus {
    if (isAccountProviderId(providerId)) {
      const bundle = providerId === 'grok-account' ? this.readBundle('grok-account') : null;
      this.clearFlows(providerId);
      if (bundle) {
        void this.revokeGrokBundle(bundle);
      }
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

  private async startChatGptLogin(): Promise<LlmProviderAccountStatus> {
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
    await this.startChatGptCallbackServer(flow);
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

  private async startGrokLogin(oauthClientId?: string): Promise<LlmProviderAccountStatus> {
    const resolved = resolveGrokOAuthClientId(oauthClientId);
    if (!resolved.clientId) {
      return this.status(
        'grok-account',
        'Grok OAuth client id is required. Enter an OAuth client id or set RDC_AGENT_GROK_OAUTH_CLIENT_ID.',
        'failed',
      );
    }

    try {
      const payload = await fetchJson(GROK_AUTH_DEVICE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createFormBody({
          client_id: resolved.clientId,
          scope: GROK_OAUTH_SCOPE,
        }),
      }) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        verification_uri_complete?: string;
        expires_in?: number;
        interval?: number;
      };
      if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
        throw new Error('xAI OAuth did not return a complete device authorization payload.');
      }
      const flow: OAuthFlowState = {
        providerId: 'grok-account',
        flowId: randomUUID(),
        state: randomUUID(),
        deviceCode: payload.device_code,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
        authUrl: payload.verification_uri_complete ?? payload.verification_uri,
        intervalSeconds: payload.interval ?? 5,
        clientId: resolved.clientId,
        expiresAt: Date.now() + (payload.expires_in ?? 900) * 1000,
      };
      this.setFlow(flow);
      void this.openExternal(flow.authUrl);
      void this.pollGrokDevice(flow)
        .then((bundle) => this.persistAccount('grok-account', bundle))
        .catch((error) => {
          flow.error = parseProviderError(error);
        });
      return this.status(flow.providerId);
    } catch (error) {
      return this.status('grok-account', parseProviderError(error), 'failed');
    }
  }

  private startUnimplementedAccountLogin(providerId: AccountProviderId): LlmProviderAccountStatus {
    const definition = getBuiltinProviderDefinition(providerId);
    const flow: OAuthFlowState = {
      providerId,
      flowId: randomUUID(),
      state: randomUUID(),
      authUrl: definition?.docsUrl,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.setFlow(flow);
    void this.openExternal(flow.authUrl);
    return this.status(
      flow.providerId,
      isTestMode()
        ? 'Test-only account authorization flow started.'
        : 'Live account OAuth is not configured for this provider; automated test-mode verification is the only available path.',
    );
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
    if (!tokenPayload.access_token) {
      throw new Error('OpenAI OAuth did not return an access token.');
    }
    return {
      providerId: 'chatgpt-account',
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      apiKey: tokenPayload.access_token,
      idToken: tokenPayload.id_token,
      accountId: extractChatGptAccountId(tokenPayload.id_token),
      expiresAt: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1000).toISOString(),
      accountLabel: 'ChatGPT Account',
    };
  }

  private async pollGitHubDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
    if (!flow.deviceCode) {
      throw new Error('GitHub device code is missing.');
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode();
    for (;;) {
      if (Date.now() > flow.expiresAt) {
        throw new Error('GitHub authorization code expired.');
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1000);
      }
      delayBeforePoll = true;
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
        delete flow.error;
        continue;
      }
      if (payload.error === 'slow_down') {
        delete flow.error;
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
          ...COPILOT_EDITOR_HEADERS,
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

  private async pollGrokDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
    if (!flow.deviceCode || !flow.clientId) {
      throw new Error('Grok device authorization is missing client or device code.');
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode();
    for (;;) {
      if (Date.now() > flow.expiresAt) {
        throw new Error('Grok authorization code expired.');
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1000);
      }
      delayBeforePoll = true;
      const payload = await fetchOAuthJson(GROK_AUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createFormBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: flow.clientId,
          device_code: flow.deviceCode,
        }),
      }) as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (payload.error === 'authorization_pending') {
        delete flow.error;
        continue;
      }
      if (payload.error === 'slow_down') {
        delete flow.error;
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        throw new Error(payload.error_description ?? payload.error);
      }
      if (!payload.access_token) {
        throw new Error('xAI OAuth did not return an access token.');
      }
      const account = await this.fetchGrokUserInfo(payload.access_token);
      return {
        providerId: 'grok-account',
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        refreshToken: payload.refresh_token,
        idToken: payload.id_token,
        clientId: flow.clientId,
        accountId: account.accountId,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
        accountLabel: account.accountLabel ?? 'Grok Account',
        planLabel: 'xAI OAuth',
      };
    }
  }

  private async fetchGrokUserInfo(accessToken: string): Promise<{ accountId?: string; accountLabel?: string }> {
    try {
      const payload = await fetchJson(GROK_AUTH_USERINFO_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      return {
        accountId: readString(record.sub),
        accountLabel: readString(record.email) ?? readString(record.name) ?? readString(record.preferred_username) ?? readString(record.sub),
      };
    } catch {
      return {};
    }
  }

  private exchangeUnimplementedAccountCode(flow: OAuthFlowState, code: string): OAuthSecretBundle {
    if (!isUnimplementedAccountProviderId(flow.providerId)) {
      throw new Error('Provider is not an unimplemented account adapter.');
    }
    if (!isTestMode()) {
      const definition = getBuiltinProviderDefinition(flow.providerId);
      throw new Error(definition?.unavailableReason ?? 'Live account OAuth is not configured for this provider.');
    }
    if (!code) {
      throw new Error('Authorization code is required.');
    }
    return {
      providerId: flow.providerId,
      accessToken: `test-${flow.providerId}-${flow.state}`,
      apiKey: `test-${flow.providerId}-${flow.state}`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      accountLabel: getBuiltinProviderDefinition(flow.providerId)?.label ?? flow.providerId,
      planLabel: 'Test account',
    };
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
    if (bundle.providerId !== 'github-copilot' && !isExpiringSoon(bundle.expiresAt)) {
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
          ...COPILOT_EDITOR_HEADERS,
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

    if (bundle.providerId === 'grok-account') {
      if (!bundle.refreshToken || !bundle.clientId) {
        return bundle;
      }
      const payload = await fetchOAuthJson(GROK_AUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createFormBody({
          grant_type: 'refresh_token',
          client_id: bundle.clientId,
          refresh_token: bundle.refreshToken,
        }),
      }) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string };
      if (payload.error) {
        throw new Error(payload.error_description ?? payload.error);
      }
      if (!payload.access_token) {
        throw new Error('xAI OAuth refresh did not return an access token.');
      }
      return {
        ...bundle,
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        idToken: payload.id_token ?? bundle.idToken,
        refreshToken: payload.refresh_token ?? bundle.refreshToken,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      };
    }

    if (isUnimplementedAccountProviderId(bundle.providerId)) {
      return bundle;
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
    }) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new Error('OpenAI OAuth refresh did not return an access token.');
    }
    return {
      ...bundle,
      accessToken: payload.access_token,
      apiKey: payload.access_token,
      idToken: payload.id_token ?? bundle.idToken,
      accountId: extractChatGptAccountId(payload.id_token) ?? bundle.accountId,
      refreshToken: payload.refresh_token ?? bundle.refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  private async discoverModels(bundle: OAuthSecretBundle): Promise<LlmProviderModel[]> {
    if (
      bundle.providerId === 'chatgpt-account'
      || bundle.providerId === 'claude-account'
      || isUnimplementedAccountProviderId(bundle.providerId)
    ) {
      return createAccountCatalogModels(bundle.providerId);
    }
    if (bundle.providerId === 'grok-account') {
      const token = bundle.accessToken ?? bundle.apiKey;
      if (!token) {
        throw new Error('Grok account access token is missing. Sign in again.');
      }
      const payload = await fetchJson(`${GROK_API_BASE_URL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return parseModels(payload);
    }
    if (bundle.providerId === 'github-copilot') {
      const catalogModels = createAccountCatalogModels(bundle.providerId);
      const baseUrl = (bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com').replace(/\/+$/, '');
      try {
        const payload = await fetchJson(`${baseUrl}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${bundle.copilotToken}`,
            'Content-Type': 'application/json',
            ...COPILOT_WIRE_HEADERS,
          },
        });
        return mergeAccountModels(catalogModels, parseCopilotModels(payload));
      } catch {
        return catalogModels;
      }
    }
    const payload = await fetchJson('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bundle.apiKey ?? bundle.accessToken}`,
      },
    });
    return parseModels(payload);
  }

  private async revokeGrokBundle(bundle: OAuthSecretBundle): Promise<void> {
    if (bundle.providerId !== 'grok-account' || !bundle.clientId) {
      return;
    }
    const token = bundle.refreshToken ?? bundle.accessToken ?? bundle.apiKey;
    if (!token) {
      return;
    }
    try {
      await fetchOAuthJson(GROK_AUTH_REVOKE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createFormBody({
          client_id: bundle.clientId,
          token,
          token_type_hint: bundle.refreshToken ? 'refresh_token' : 'access_token',
        }),
      });
    } catch {
      // Local sign-out must still complete even if remote revocation is unavailable.
    }
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
        this.closeFlowServer(flow);
        pendingFlows.delete(flowId);
      }
    }
  }

  private closeFlowServer(flow: OAuthFlowState): void {
    const server = flow.server;
    if (!server) {
      return;
    }
    delete flow.server;
    if (server.listening) {
      server.close();
    }
  }

  private startChatGptCallbackServer(flow: OAuthFlowState): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
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
          })
          .finally(() => {
            this.closeFlowServer(flow);
          });
      });
      flow.server = server;
      server.on('error', (error) => {
        flow.error = parseProviderError(error);
        this.closeFlowServer(flow);
        pendingFlows.delete(flow.flowId);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      server.listen(CHATGPT_CALLBACK_PORT, '127.0.0.1', () => {
        settled = true;
        resolve();
      });
    });
  }

  private async openExternal(url?: string): Promise<void> {
    if (!url || isTestMode()) {
      return;
    }
    await shell.openExternal(url);
  }
}

export const providerAccountAuthService = new ProviderAccountAuthService();
