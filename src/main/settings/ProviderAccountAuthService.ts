import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginMode,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import { getBuiltinProviderDefinition, SUPER_GROK_OAUTH_CALLBACK_PORT, SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import { getManagedProviderModels } from '@shared/constants/modelCapabilityCatalog';
import { COPILOT_EDITOR_HEADERS, COPILOT_WIRE_HEADERS } from './CopilotWire';
import { parseCopilotModelCatalog } from './CopilotBilling';
import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { settingsService } from './SettingsService';
import { oauthRefreshManager } from './OAuthRefreshManager';

const REQUEST_TIMEOUT_MS = 20000;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GROK_OPENID_CONFIGURATION_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const GROK_OAUTH_REQUESTED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'api:access'] as const;
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
  clientIdSource?: 'manual' | 'env';
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  expiresAt: number;
  server?: Server;
  error?: string;
  diagnostic?: LlmProviderAccountDiagnostic;
}

interface OAuthSecretBundle {
  providerId: AccountProviderId;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  copilotToken?: string;
  copilotApiBaseUrl?: string;
  copilotModelBilling?: Record<string, unknown>;
  idToken?: string;
  clientId?: string;
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  accountId?: string;
  expiresAt?: string;
  accountLabel?: string;
  planLabel?: string;
}

interface GrokOAuthMetadata {
  authorizationEndpoint: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  revocationEndpoint: string;
  scopesSupported: string[];
  grantTypesSupported: string[];
  codeChallengeMethodsSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
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

const resolveGrokOAuthClientId = (draft?: string): { clientId?: string; source?: 'manual' | 'env' } => {
  const cleanDraft = draft?.trim();
  if (cleanDraft) {
    return { clientId: cleanDraft, source: 'manual' };
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

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
);

const parseGrokOAuthMetadata = (payload: unknown): GrokOAuthMetadata => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const metadata: GrokOAuthMetadata = {
    authorizationEndpoint: readString(record.authorization_endpoint) ?? '',
    deviceAuthorizationEndpoint: readString(record.device_authorization_endpoint) ?? '',
    tokenEndpoint: readString(record.token_endpoint) ?? '',
    userinfoEndpoint: readString(record.userinfo_endpoint) ?? '',
    revocationEndpoint: readString(record.revocation_endpoint) ?? '',
    scopesSupported: readStringArray(record.scopes_supported),
    grantTypesSupported: readStringArray(record.grant_types_supported),
    codeChallengeMethodsSupported: readStringArray(record.code_challenge_methods_supported),
    tokenEndpointAuthMethodsSupported: readStringArray(record.token_endpoint_auth_methods_supported),
  };
  if (!metadata.authorizationEndpoint || !metadata.deviceAuthorizationEndpoint || !metadata.tokenEndpoint || !metadata.userinfoEndpoint || !metadata.revocationEndpoint) {
    throw new Error('xAI OAuth metadata is missing required browser, device, token, userinfo, or revocation endpoints.');
  }
  if (metadata.grantTypesSupported.length > 0) {
    if (!metadata.grantTypesSupported.includes('authorization_code')) {
      throw new Error('xAI OAuth metadata does not advertise browser authorization-code support.');
    }
    if (!metadata.grantTypesSupported.includes('urn:ietf:params:oauth:grant-type:device_code')) {
      throw new Error('xAI OAuth metadata does not advertise device authorization support.');
    }
  }
  if (metadata.codeChallengeMethodsSupported.length > 0 && !metadata.codeChallengeMethodsSupported.includes('S256')) {
    throw new Error('xAI OAuth metadata does not advertise PKCE S256 support.');
  }
  if (metadata.tokenEndpointAuthMethodsSupported.length > 0 && !metadata.tokenEndpointAuthMethodsSupported.includes('none')) {
    throw new Error('xAI OAuth metadata does not advertise public-client token exchange support.');
  }
  return metadata;
};

const fetchGrokOAuthMetadata = async (): Promise<GrokOAuthMetadata> => {
  const payload = await fetchJson(GROK_OPENID_CONFIGURATION_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return parseGrokOAuthMetadata(payload);
};

const resolveGrokOAuthScope = (metadata: GrokOAuthMetadata): string => {
  const supported = new Set(metadata.scopesSupported);
  const requested = GROK_OAUTH_REQUESTED_SCOPES.filter((scope) => (
    supported.size === 0 || supported.has(scope)
  ));
  const missing = GROK_OAUTH_REQUESTED_SCOPES.filter((scope) => (
    supported.size > 0 && !supported.has(scope)
  ));
  if (requested.length === 0 || missing.includes('api:access')) {
    throw new Error(
      'xAI OAuth metadata does not support the required API scope. Missing scopes: '
      + (missing.join(', ') || 'unknown')
      + '.',
    );
  }
  return requested.join(' ');
};

const readOAuthError = (payload: unknown): { error?: string; detail?: string } => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  return {
    error: readString(record.error),
    detail: readString(record.error_description) ?? readString(record.message),
  };
};

const SUPER_GROK_OAUTH_CHECKLIST = [
  'Use an xAI-issued public OAuth client id, not an xAI API key.',
  'Register the RDC-Agent loopback redirect URI for browser login.',
  'Allow the requested Super Grok scopes for this OAuth client.',
  'Confirm the Super Grok or X Premium account has Grok API access.',
];

const createGrokOAuthDiagnostic = (
  stage: LlmProviderAccountDiagnostic['stage'],
  summary: string,
  options: Partial<Omit<LlmProviderAccountDiagnostic, 'stage' | 'summary'>> = {},
): LlmProviderAccountDiagnostic => ({
  stage,
  summary,
  detail: options.detail,
  providerError: options.providerError,
  requestedScopes: options.requestedScopes,
  redirectUri: options.redirectUri,
  checklist: options.checklist ?? SUPER_GROK_OAUTH_CHECKLIST,
});

const renderGrokOAuthDiagnosticMessage = (diagnostic: LlmProviderAccountDiagnostic): string => [
  diagnostic.summary,
  diagnostic.requestedScopes ? 'Requested scopes: ' + diagnostic.requestedScopes + '.' : '',
  diagnostic.redirectUri ? 'Redirect URI: ' + diagnostic.redirectUri + '.' : '',
  diagnostic.providerError ? 'Provider error: ' + diagnostic.providerError + '.' : '',
  diagnostic.detail ? 'Detail: ' + diagnostic.detail + '.' : '',
].filter(Boolean).join(' ');

const createGrokOAuthFailureDiagnostic = (
  stage: LlmProviderAccountDiagnostic['stage'],
  operation: string,
  payload: unknown,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => {
  const { error, detail } = readOAuthError(payload);
  return createGrokOAuthDiagnostic(
    stage,
    'Super Grok OAuth ' + operation + ' failed. Check the xAI public OAuth Client ID, redirect URI, and allowed scopes.',
    {
      providerError: error || parseProviderError(payload),
      detail,
      requestedScopes: scope,
      redirectUri,
    },
  );
};


class GrokOAuthDiagnosticError extends Error {
  constructor(readonly diagnostic: LlmProviderAccountDiagnostic) {
    super(renderGrokOAuthDiagnosticMessage(diagnostic));
  }
}

const createGrokOAuthStartupDiagnostic = (
  error: unknown,
  mode: LlmProviderAccountLoginMode,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => {
  const message = parseProviderError(error);
  const stage: LlmProviderAccountDiagnostic['stage'] = message.startsWith('xAI OAuth metadata') ? 'metadata' : 'authorization';
  if (message.startsWith('Super Grok OAuth ') || message.startsWith('xAI OAuth metadata')) {
    return createGrokOAuthDiagnostic(stage, message, { requestedScopes: scope, redirectUri });
  }
  return createGrokOAuthDiagnostic(
    stage,
    'Super Grok OAuth ' + mode + ' authorization failed. Check the xAI public OAuth Client ID, xAI OAuth metadata network access, redirect URI, and allowed scopes.',
    { detail: message, requestedScopes: scope, redirectUri },
  );
};

const resolveGrokOAuthDiagnostic = (
  error: unknown,
  mode: LlmProviderAccountLoginMode,
  scope?: string,
  redirectUri?: string,
): LlmProviderAccountDiagnostic => (
  error instanceof GrokOAuthDiagnosticError
    ? error.diagnostic
    : createGrokOAuthStartupDiagnostic(error, mode, scope, redirectUri)
);


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
  const seen = new Set<string>();
  return getManagedProviderModels(providerId)
    .filter((model) => {
      if (!model.id || seen.has(model.id) || !isAgentRoutableAccountModel(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
};

const isAgentRoutableAccountModel = (modelId: string): boolean => {
  return isAdmittedDiscoveredModel(modelId);
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
      return this.startGrokLogin(request.oauthClientId, request.accountLoginMode);
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
        const bundle = flow.authorizationMode === 'browser'
          ? await this.exchangeGrokCode(flow, request.code?.trim() ?? '')
          : await this.pollGrokDevice(flow);
        return await this.persistAccount(request.providerId, bundle);
      }
      return this.status(request.providerId, 'Provider does not support account login.', 'failed');
    } catch (error) {
      if (request.providerId === 'grok-account') {
        const diagnostic = createGrokOAuthStartupDiagnostic(
          error,
          flow.authorizationMode === 'device' ? 'device' : 'browser',
          flow.requestedScopes,
          flow.redirectUri,
        );
        flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
        flow.diagnostic = diagnostic;
        return this.status(request.providerId, flow.error, 'failed', diagnostic);
      }
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

  async forceRefreshRuntimeCredentials(providerId: LlmProviderId): Promise<void> {
    if (!isAccountProviderId(providerId)) return;
    const bundle = this.readBundle(providerId);
    if (!bundle) throw new Error('Account is not connected.');
    await this.refreshBundleIfNeeded(bundle, true);
  }

  status(
    providerId: LlmProviderId,
    message?: string,
    forcedState?: LlmProviderAccountStatus['state'],
    diagnostic?: LlmProviderAccountDiagnostic,
  ): LlmProviderAccountStatus {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const isAccount = isAccountProviderId(providerId);
    const flow = isAccount ? this.findFlow(providerId) : null;
    const connected = Boolean(provider?.isConfigured && provider.status === 'verified');
    const grokBundle = providerId === 'grok-account' ? this.readBundle('grok-account') : null;
    const grokClientIdSource = providerId === 'grok-account'
      ? flow?.clientIdSource
        ?? (connected && grokBundle?.clientId
          ? 'stored'
          : resolveGrokOAuthClientId().source)
      : undefined;
    const state: LlmProviderAccountStatus['state'] = forcedState
      ?? (connected ? 'connected' : flow?.error ? 'failed' : flow ? 'pending' : isAccount ? 'signed-out' : 'unavailable');
    const pendingMessage = providerId === 'github-copilot'
      ? 'Waiting for GitHub authorization.'
      : providerId === 'grok-account'
        ? flow?.authorizationMode === 'device'
          ? 'Waiting for Super Grok device-code authorization.'
          : 'Waiting for Super Grok browser authorization.'
        : 'Waiting for authorization.';
    const activeDiagnostic = diagnostic ?? flow?.diagnostic;
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
      oauthRefreshAvailable: provider?.oauthRefreshAvailable,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow?.providerId === 'claude-account' || (flow && isUnimplementedAccountProviderId(flow.providerId))),
      requiresClientId: providerId === 'grok-account' && !connected && !grokClientIdSource,
      clientIdSource: grokClientIdSource,
      authorizationMode: flow?.authorizationMode ?? grokBundle?.authorizationMode,
      diagnostic: activeDiagnostic,
      requestedScopes: flow?.requestedScopes ?? activeDiagnostic?.requestedScopes ?? grokBundle?.requestedScopes,
      redirectUri: flow?.redirectUri ?? activeDiagnostic?.redirectUri ?? grokBundle?.redirectUri,
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

  private async startGrokLogin(
    oauthClientId?: string,
    accountLoginMode?: LlmProviderAccountLoginMode,
  ): Promise<LlmProviderAccountStatus> {
    const mode: LlmProviderAccountLoginMode = accountLoginMode === 'device' ? 'device' : 'browser';
    const resolved = resolveGrokOAuthClientId(oauthClientId);
    if (!resolved.clientId) {
      const diagnostic = createGrokOAuthDiagnostic(
        'configuration',
        'Super Grok OAuth requires an xAI-issued public OAuth Client ID. This is not an xAI API key.',
        { redirectUri: mode === 'browser' ? SUPER_GROK_OAUTH_REDIRECT_URI : undefined },
      );
      return this.status('grok-account', renderGrokOAuthDiagnosticMessage(diagnostic), 'failed', diagnostic);
    }
    return mode === 'device'
      ? this.startGrokDeviceLogin(resolved.clientId, resolved.source ?? 'manual')
      : this.startGrokBrowserLogin(resolved.clientId, resolved.source ?? 'manual');
  }

  private async startGrokBrowserLogin(clientId: string, clientIdSource: 'manual' | 'env'): Promise<LlmProviderAccountStatus> {
    let scope: string | undefined;
    try {
      const metadata = await fetchGrokOAuthMetadata();
      scope = resolveGrokOAuthScope(metadata);
      const { verifier, challenge } = createPkce();
      const flow: OAuthFlowState = {
        providerId: 'grok-account',
        flowId: randomUUID(),
        state: randomUUID(),
        codeVerifier: verifier,
        authUrl: '',
        clientId,
        clientIdSource,
        authorizationMode: 'browser',
        requestedScopes: scope,
        redirectUri: SUPER_GROK_OAUTH_REDIRECT_URI,
        tokenEndpoint: metadata.tokenEndpoint,
        userinfoEndpoint: metadata.userinfoEndpoint,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      flow.authUrl = appendParams(metadata.authorizationEndpoint, {
        client_id: clientId,
        response_type: 'code',
        redirect_uri: SUPER_GROK_OAUTH_REDIRECT_URI,
        scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: flow.state,
      });
      this.setFlow(flow);
      await this.startGrokCallbackServer(flow);
      void this.openExternal(flow.authUrl);
      return this.status(flow.providerId);
    } catch (error) {
      const diagnostic = resolveGrokOAuthDiagnostic(error, 'browser', scope, SUPER_GROK_OAUTH_REDIRECT_URI);
      return this.status('grok-account', renderGrokOAuthDiagnosticMessage(diagnostic), 'failed', diagnostic);
    }
  }

  private async startGrokDeviceLogin(clientId: string, clientIdSource: 'manual' | 'env'): Promise<LlmProviderAccountStatus> {
    let scope: string | undefined;
    try {
      const metadata = await fetchGrokOAuthMetadata();
      scope = resolveGrokOAuthScope(metadata);
      const payload = await fetchOAuthJson(metadata.deviceAuthorizationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createFormBody({
          client_id: clientId,
          scope,
        }),
      }) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        verification_uri_complete?: string;
        expires_in?: number;
        interval?: number;
        error?: string;
        error_description?: string;
      };
      if (payload.error) {
        throw new GrokOAuthDiagnosticError(createGrokOAuthFailureDiagnostic('authorization', 'device authorization', payload, scope));
      }
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
        clientId,
        clientIdSource,
        authorizationMode: 'device',
        requestedScopes: scope,
        tokenEndpoint: metadata.tokenEndpoint,
        userinfoEndpoint: metadata.userinfoEndpoint,
        expiresAt: Date.now() + (payload.expires_in ?? 900) * 1000,
      };
      this.setFlow(flow);
      void this.openExternal(flow.authUrl);
      void this.pollGrokDevice(flow)
        .then((bundle) => this.persistAccount('grok-account', bundle))
        .catch((error) => {
          const diagnostic = resolveGrokOAuthDiagnostic(error, 'device', flow.requestedScopes, flow.redirectUri);
          flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
          flow.diagnostic = diagnostic;
        });
      return this.status(flow.providerId);
    } catch (error) {
      const diagnostic = resolveGrokOAuthDiagnostic(error, 'device', scope);
      return this.status('grok-account', renderGrokOAuthDiagnosticMessage(diagnostic), 'failed', diagnostic);
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

  private async exchangeGrokCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
    if (!code || !flow.codeVerifier || !flow.clientId || !flow.redirectUri) {
      throw new Error('Super Grok browser authorization callback is missing code, PKCE verifier, client id, or redirect URI.');
    }
    const tokenEndpoint = flow.tokenEndpoint ?? (await fetchGrokOAuthMetadata()).tokenEndpoint;
    const payload = await fetchOAuthJson(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: createFormBody({
        grant_type: 'authorization_code',
        client_id: flow.clientId,
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.codeVerifier,
      }),
    }) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (payload.error) {
      throw new GrokOAuthDiagnosticError(createGrokOAuthFailureDiagnostic('token', 'browser token exchange', payload, flow.requestedScopes, flow.redirectUri));
    }
    if (!payload.access_token) {
      throw new Error('xAI OAuth did not return an access token.');
    }
    const account = await this.fetchGrokUserInfo(payload.access_token, flow.userinfoEndpoint);
    return {
      providerId: 'grok-account',
      accessToken: payload.access_token,
      apiKey: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken: payload.id_token,
      clientId: flow.clientId,
      authorizationMode: 'browser',
      requestedScopes: flow.requestedScopes,
      redirectUri: flow.redirectUri,
      accountId: account.accountId,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      accountLabel: account.accountLabel ?? 'Super Grok Account',
      planLabel: 'Super Grok OAuth',
    };
  }

  private async pollGrokDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
    if (!flow.deviceCode || !flow.clientId) {
      throw new Error('Super Grok device authorization is missing client or device code.');
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode();
    for (;;) {
      if (Date.now() > flow.expiresAt) {
        throw new Error('Super Grok authorization code expired.');
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1000);
      }
      delayBeforePoll = true;
      const tokenEndpoint = flow.tokenEndpoint ?? (await fetchGrokOAuthMetadata()).tokenEndpoint;
      const payload = await fetchOAuthJson(tokenEndpoint, {
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
        throw new GrokOAuthDiagnosticError(createGrokOAuthFailureDiagnostic('token', 'device token polling', payload, flow.requestedScopes));
      }
      if (!payload.access_token) {
        throw new Error('xAI OAuth did not return an access token.');
      }
      const account = await this.fetchGrokUserInfo(payload.access_token, flow.userinfoEndpoint);
      return {
        providerId: 'grok-account',
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        refreshToken: payload.refresh_token,
        idToken: payload.id_token,
        clientId: flow.clientId,
        authorizationMode: 'device',
        requestedScopes: flow.requestedScopes,
        accountId: account.accountId,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
        accountLabel: account.accountLabel ?? 'Super Grok Account',
        planLabel: 'Super Grok OAuth',
      };
    }
  }

  private async fetchGrokUserInfo(accessToken: string, userinfoEndpoint?: string): Promise<{ accountId?: string; accountLabel?: string }> {
    try {
      const endpoint = userinfoEndpoint ?? (await fetchGrokOAuthMetadata()).userinfoEndpoint;
      const payload = await fetchJson(endpoint, {
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

  private async refreshBundleIfNeeded(bundle: OAuthSecretBundle, force = false): Promise<OAuthSecretBundle> {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === bundle.providerId);
    const accountId = provider?.activeAccountId ?? bundle.accountId ?? `anonymous:${bundle.providerId}`;
    return oauthRefreshManager.refresh({
      key: { providerId: bundle.providerId, accountId },
      current: bundle,
      expiresAt: bundle.expiresAt,
      force: force || (bundle.providerId === 'github-copilot' && !bundle.copilotToken),
      refresh: () => this.performBundleRefresh(bundle),
      commit: (refreshed) => {
        settingsService.rotateProviderAccountCredential(bundle.providerId, JSON.stringify(refreshed), {
          accountLabel: refreshed.accountLabel,
          planLabel: refreshed.planLabel,
          oauthExpiresAt: refreshed.expiresAt,
          oauthRefreshAvailable: canRefreshBundle(refreshed),
        });
      },
      onInvalidGrant: (error) => {
        settingsService.markProviderAccountRefreshFailure(bundle.providerId, error.message);
      },
    });
  }

  private async performBundleRefresh(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
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
      const metadata = await fetchGrokOAuthMetadata();
      const payload = await fetchOAuthJson(metadata.tokenEndpoint, {
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
        throw new GrokOAuthDiagnosticError(createGrokOAuthFailureDiagnostic('refresh', 'token refresh', payload, bundle.requestedScopes, bundle.redirectUri));
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
    if (bundle.providerId === 'github-copilot' && bundle.copilotToken) {
      try {
        const baseUrl = (bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com').replace(/\/+$/, '');
        const payload = await fetchJson(`${baseUrl}/models`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${bundle.copilotToken}`,
            ...COPILOT_WIRE_HEADERS,
          },
        });
        const parsed = parseCopilotModelCatalog(payload);
        const models = parsed.models.filter((model) => isAgentRoutableAccountModel(model.id));
        if (models.length > 0) {
          bundle.copilotModelBilling = Object.fromEntries(
            Object.entries(parsed.billingByModel).filter(([modelId]) => models.some((model) => model.id === modelId)),
          );
          return models;
        }
      } catch {
        // Account login remains usable with the conservative bundled seed.
      }
      delete bundle.copilotModelBilling;
    }
    const models = createAccountCatalogModels(bundle.providerId);
    if (models.length === 0) {
      throw new Error(`Account provider ${bundle.providerId} is missing an app-managed model catalog.`);
    }
    return models;
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
      const metadata = await fetchGrokOAuthMetadata();
      await fetchOAuthJson(metadata.revocationEndpoint, {
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

  private startGrokCallbackServer(flow: OAuthFlowState): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', `http://localhost:${SUPER_GROK_OAUTH_CALLBACK_PORT}`);
        if (url.pathname !== '/oauth/grok/callback') {
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Not found.');
          return;
        }

        const failCallback = (diagnostic: LlmProviderAccountDiagnostic, statusCode = 400) => {
          flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
          flow.diagnostic = diagnostic;
          response.writeHead(statusCode, { 'Content-Type': 'text/plain' });
          response.end(flow.error);
          this.closeFlowServer(flow);
        };

        if (url.searchParams.get('state') !== flow.state) {
          failCallback(createGrokOAuthDiagnostic(
            'callback',
            'Super Grok OAuth browser callback failed because the returned state did not match the active login flow.',
            { requestedScopes: flow.requestedScopes, redirectUri: flow.redirectUri },
          ));
          return;
        }

        const providerError = url.searchParams.get('error') ?? '';
        if (providerError) {
          failCallback(createGrokOAuthDiagnostic(
            'callback',
            'Super Grok OAuth browser callback was rejected by xAI.',
            {
              providerError,
              detail: url.searchParams.get('error_description') ?? undefined,
              requestedScopes: flow.requestedScopes,
              redirectUri: flow.redirectUri,
            },
          ));
          return;
        }

        const code = url.searchParams.get('code') ?? '';
        if (!code) {
          failCallback(createGrokOAuthDiagnostic(
            'callback',
            'Super Grok OAuth browser callback did not include an authorization code.',
            { requestedScopes: flow.requestedScopes, redirectUri: flow.redirectUri },
          ));
          return;
        }

        void this.finishLogin({ providerId: flow.providerId, flowId: flow.flowId, code })
          .then((status) => {
            if (!status.connected) {
              response.writeHead(500, { 'Content-Type': 'text/plain' });
              response.end(status.error ?? status.message ?? 'Super Grok OAuth failed.');
              return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end('<html><body>RDC Agent Super Grok sign-in complete. You can return to the app.</body></html>');
          })
          .catch((error) => {
            const diagnostic = resolveGrokOAuthDiagnostic(error, 'browser', flow.requestedScopes, flow.redirectUri);
            flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
            flow.diagnostic = diagnostic;
            response.writeHead(500, { 'Content-Type': 'text/plain' });
            response.end(flow.error);
          })
          .finally(() => {
            this.closeFlowServer(flow);
          });
      });
      flow.server = server;
      server.on('error', (error) => {
        const diagnostic = resolveGrokOAuthDiagnostic(error, 'browser', flow.requestedScopes, flow.redirectUri);
        flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
        flow.diagnostic = diagnostic;
        this.closeFlowServer(flow);
        pendingFlows.delete(flow.flowId);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      server.listen(SUPER_GROK_OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
        settled = true;
        resolve();
      });
    });
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
