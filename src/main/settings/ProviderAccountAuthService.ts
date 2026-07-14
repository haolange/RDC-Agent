import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { shell } from 'electron';
import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginMode,
  LlmProviderAccountRegion,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import { COPILOT_EDITOR_HEADERS, COPILOT_WIRE_HEADERS } from './CopilotWire';
import { CLAUDE_ACCOUNT_WIRE_HEADERS } from './ClaudeWire';
import { parseCopilotModelCatalog } from './CopilotBilling';
import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { settingsService } from './SettingsService';
import { oauthRefreshManager } from './OAuthRefreshManager';
import { getProviderSeedModels } from './ProviderPresetRegistry';
import {
  mergeParsedLiveCatalogs,
  parseChatGptAccountCatalog,
  parseClaudeAccountCatalog,
  parseGrokAccountCatalog,
  parseGrokBuilderCatalog,
  parseOpenRouterAccountCatalog,
} from './LiveProviderCatalogParsers';
import type { CatalogModelContribution } from './EffectiveCatalogService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import {
  buildMiniMaxAuthorizationRequest,
  buildMiniMaxRefresh,
  buildMiniMaxTokenPoll,
  buildOpenRouterAuthorizationUrl,
  buildOpenRouterExchange,
  createPkcePair,
  miniMaxRegionContract,
  parseOpenRouterExchange,
  resolveMiniMaxExpiry,
  type MiniMaxRegion,
} from './LiveProviderOAuthContracts';

const REQUEST_TIMEOUT_MS = 20000;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const GITHUB_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GROK_OPENID_CONFIGURATION_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const GROK_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const GROK_OAUTH_REQUESTED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'] as const;
const GROK_BUILD_API_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
const XAI_API_BASE_URL = 'https://api.x.ai/v1';
const CHATGPT_CATALOG_CLIENT_VERSION = '1.0.0';

type AccountProviderId =
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot'
  | 'grok-account'
  | 'minimax-account'
  | 'openrouter';

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
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  region?: MiniMaxRegion;
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
  authorizationMode?: LlmProviderAccountLoginMode;
  requestedScopes?: string;
  redirectUri?: string;
  accountId?: string;
  expiresAt?: string;
  accountLabel?: string;
  planLabel?: string;
  region?: MiniMaxRegion;
  inferenceBaseUrl?: string;
  resourceUrl?: string;
}

export interface AccountCatalogDiscovery {
  models: LlmProviderModel[];
  contributions?: CatalogModelContribution[];
  entitlementContributions?: CatalogModelContribution[];
  detail?: string;
}

type AccountCatalogPublisher = (
  providerId: AccountProviderId,
  discovery: AccountCatalogDiscovery,
) => Promise<void>;

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

const isAccountProviderId = (providerId: LlmProviderId): providerId is AccountProviderId =>
  providerId === 'claude-account'
  || providerId === 'chatgpt-account'
  || providerId === 'github-copilot'
  || providerId === 'grok-account'
  || providerId === 'minimax-account'
  || providerId === 'openrouter';

const isTestMode = (): boolean => process.env.RDC_AGENT_TEST_MODE === '1';
const shouldOpenSystemBrowser = (): boolean => !isTestMode() && process.env.RDC_AGENT_HEADLESS !== '1';

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
  if (requested.length === 0 || missing.includes('grok-cli:access')) {
    throw new Error(
      'xAI OAuth metadata does not support the required Grok Build scope. Missing scopes: '
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
  'Use a SuperGrok or X Premium Plus account with Grok Build access.',
  'Allow the requested Grok Build and API scopes in the browser.',
  'Copy the one-time code shown by xAI back into RDC Agent before it expires.',
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
  return getProviderSeedModels(providerId)
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
    return Boolean(bundle.refreshToken);
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

function pendingAuthorizationMessage(
  providerId: LlmProviderId,
  mode: LlmProviderAccountLoginMode | undefined,
): string {
  if (providerId === 'github-copilot') return 'Waiting for GitHub authorization.';
  if (providerId === 'grok-account') {
    return mode === 'device'
      ? 'Waiting for Super Grok device-code authorization.'
      : 'xAI is displaying a one-time code. Paste it into RDC Agent to finish connecting.';
  }
  if (providerId === 'minimax-account') return 'Waiting for MiniMax account authorization.';
  if (providerId === 'openrouter') return 'Waiting for OpenRouter browser authorization.';
  return 'Waiting for authorization.';
}

export class ProviderAccountAuthService {
  private catalogPublisher?: AccountCatalogPublisher;
  private readonly pendingFlows = new Map<string, OAuthFlowState>();
  private lastGrokCatalogSourceDiagnostic?: string;

  setCatalogPublisher(publisher?: AccountCatalogPublisher): void {
    this.catalogPublisher = publisher;
  }

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
      return this.startGrokLogin(request.accountLoginMode);
    }
    if (providerId === 'minimax-account') {
      return this.startMiniMaxLogin(request.accountRegion);
    }
    if (providerId === 'openrouter') {
      return this.startOpenRouterLogin();
    }
    return this.status(providerId, 'Provider does not support account login.', 'failed');
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
      if (request.providerId === 'minimax-account') {
        const bundle = await this.pollMiniMaxDevice(flow);
        return await this.persistAccount(request.providerId, bundle);
      }
      if (request.providerId === 'openrouter') {
        const bundle = await this.exchangeOpenRouterCode(flow, request.code?.trim() ?? '');
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
      const discovery = await this.discoverCatalog(activeBundle);
      if (discovery.models.length === 0) {
        throw new Error('Account provider returned no usable models.');
      }
      await this.saveAccountDiscovery(providerId, activeBundle, discovery, true);
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

    const discovery = await this.discoverCatalog(activeBundle);
    await this.saveAccountDiscovery(providerId, activeBundle, discovery, true);
  }

  async loadEffectiveCatalog(providerId: LlmProviderId): Promise<AccountCatalogDiscovery> {
    if (!isAccountProviderId(providerId)) {
      throw new Error('Provider does not support account catalog discovery.');
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error('Account is not connected.');
    }
    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    const discovery = await this.discoverCatalog(activeBundle);
    await this.saveAccountDiscovery(providerId, activeBundle, discovery, false);
    return discovery;
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
    const connected = Boolean(
      provider?.isConfigured
      && provider.status === 'verified'
      && (providerId !== 'openrouter' || provider.authMode === 'account'),
    );
    const accountBundle = isAccount ? this.readBundle(providerId) : null;
    const available = isAccount && provider?.authModeAvailability?.account?.state !== 'unavailable';
    const state: LlmProviderAccountStatus['state'] = forcedState
      ?? (flow?.error ? 'failed' : flow ? 'pending' : connected ? 'connected' : isAccount ? 'signed-out' : 'unavailable');
    const pendingMessage = pendingAuthorizationMessage(providerId, flow?.authorizationMode);
    const activeDiagnostic = diagnostic ?? flow?.diagnostic;
    return {
      providerId,
      state,
      available,
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
      requiresCodeInput: flow?.providerId === 'claude-account'
        || (flow?.providerId === 'grok-account' && flow.authorizationMode === 'browser'),
      authorizationMode: flow?.authorizationMode ?? accountBundle?.authorizationMode,
      diagnostic: activeDiagnostic,
      requestedScopes: flow?.requestedScopes ?? activeDiagnostic?.requestedScopes ?? accountBundle?.requestedScopes,
      redirectUri: flow?.redirectUri ?? activeDiagnostic?.redirectUri ?? accountBundle?.redirectUri,
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
      settingsService.disconnectProvider(providerId, 'account');
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
    accountLoginMode?: LlmProviderAccountLoginMode,
  ): Promise<LlmProviderAccountStatus> {
    const mode: LlmProviderAccountLoginMode = accountLoginMode === 'device' ? 'device' : 'browser';
    return mode === 'device'
      ? this.startGrokDeviceLogin(GROK_OAUTH_CLIENT_ID)
      : this.startGrokBrowserLogin(GROK_OAUTH_CLIENT_ID);
  }

  private async startMiniMaxLogin(
    accountRegion?: LlmProviderAccountRegion,
  ): Promise<LlmProviderAccountStatus> {
    const region: MiniMaxRegion = accountRegion === 'cn' ? 'cn' : 'global';
    const { verifier, challenge } = createPkcePair();
    const state = randomUUID();
    const authorization = buildMiniMaxAuthorizationRequest(region, challenge, state);
    try {
      const payload = await fetchOAuthJson(authorization.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-request-id': randomUUID(),
        },
        body: authorization.body.toString(),
      }) as {
        user_code?: string;
        verification_uri?: string;
        expired_in?: number | string;
        interval?: number | string;
        state?: string;
      };
      if (!payload.user_code || !payload.verification_uri || payload.expired_in === undefined) {
        throw new Error('MiniMax OAuth authorization response is incomplete.');
      }
      if (payload.state !== state) {
        throw new Error('MiniMax OAuth state mismatch.');
      }
      const intervalMs = Number(payload.interval ?? 2000);
      const flow: OAuthFlowState = {
        providerId: 'minimax-account',
        flowId: randomUUID(),
        state,
        codeVerifier: verifier,
        verificationUri: payload.verification_uri,
        authUrl: payload.verification_uri,
        userCode: payload.user_code,
        intervalSeconds: Math.max(2, Number.isFinite(intervalMs) ? intervalMs / 1000 : 2),
        authorizationMode: 'device',
        requestedScopes: 'group_id profile model.completion',
        region,
        expiresAt: Date.parse(resolveMiniMaxExpiry(payload.expired_in)),
      };
      this.setFlow(flow);
      void this.openExternal(flow.authUrl);
      void this.pollMiniMaxDevice(flow)
        .then((bundle) => this.persistAccount('minimax-account', bundle))
        .catch((error) => {
          flow.error = parseProviderError(error);
        });
      return this.status(flow.providerId);
    } catch (error) {
      return this.status('minimax-account', parseProviderError(error), 'failed');
    }
  }

  private async startOpenRouterLogin(): Promise<LlmProviderAccountStatus> {
    const { verifier, challenge } = createPkcePair();
    const flow: OAuthFlowState = {
      providerId: 'openrouter',
      flowId: randomUUID(),
      state: randomUUID(),
      codeVerifier: verifier,
      authorizationMode: 'browser',
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.setFlow(flow);
    try {
      await this.startOpenRouterCallbackServer(flow, challenge);
      void this.openExternal(flow.authUrl);
      return this.status(flow.providerId);
    } catch (error) {
      this.clearFlows(flow.providerId);
      return this.status(flow.providerId, parseProviderError(error), 'failed');
    }
  }

  private async startGrokBrowserLogin(clientId: string): Promise<LlmProviderAccountStatus> {
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
      void this.openExternal(flow.authUrl);
      return this.status(flow.providerId);
    } catch (error) {
      const diagnostic = resolveGrokOAuthDiagnostic(error, 'browser', scope, SUPER_GROK_OAUTH_REDIRECT_URI);
      this.clearFlows('grok-account');
      return this.status('grok-account', renderGrokOAuthDiagnosticMessage(diagnostic), 'failed', diagnostic);
    }
  }

  private async startGrokDeviceLogin(clientId: string): Promise<LlmProviderAccountStatus> {
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

  private async pollMiniMaxDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
    if (!flow.userCode || !flow.codeVerifier || !flow.region) {
      throw new Error('MiniMax OAuth flow is missing its user code, verifier, or region.');
    }
    let delayBeforePoll = !isTestMode();
    for (;;) {
      if (Date.now() > flow.expiresAt) {
        throw new Error('MiniMax OAuth authorization expired.');
      }
      if (delayBeforePoll) await wait((flow.intervalSeconds ?? 2) * 1000);
      delayBeforePoll = true;
      const request = buildMiniMaxTokenPoll(flow.region, flow.userCode, flow.codeVerifier);
      const payload = await fetchOAuthJson(request.url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: request.body.toString(),
      }) as {
        status?: string;
        access_token?: string;
        refresh_token?: string;
        expired_in?: number | string;
        expires_in?: number | string;
        resource_url?: string;
        notification_message?: string;
        base_resp?: { status_msg?: string };
      };
      if (payload.status === 'error') {
        throw new Error(payload.base_resp?.status_msg || 'MiniMax OAuth authorization was denied.');
      }
      if (payload.status !== 'success') continue;
      if (!payload.access_token || !payload.refresh_token) {
        throw new Error('MiniMax OAuth token response is incomplete.');
      }
      return {
        providerId: 'minimax-account',
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        refreshToken: payload.refresh_token,
        region: flow.region,
        inferenceBaseUrl: miniMaxRegionContract(flow.region).inferenceBaseUrl,
        resourceUrl: payload.resource_url,
        requestedScopes: flow.requestedScopes,
        authorizationMode: 'device',
        accountId: `minimax-${randomUUID()}`,
        expiresAt: resolveMiniMaxExpiry(payload.expired_in ?? payload.expires_in),
        accountLabel: `MiniMax Account (${flow.region === 'cn' ? 'CN' : 'Global'})`,
        planLabel: payload.notification_message ?? 'MiniMax OAuth',
      };
    }
  }

  private async exchangeOpenRouterCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
    if (!code || !flow.codeVerifier) {
      throw new Error('OpenRouter authorization code is required.');
    }
    const request = buildOpenRouterExchange(code, flow.codeVerifier);
    const payload = await fetchJson(request.url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
    });
    const exchange = parseOpenRouterExchange(payload);
    return {
      providerId: 'openrouter',
      apiKey: exchange.apiKey,
      accountId: exchange.userId ?? `openrouter-${randomUUID()}`,
      authorizationMode: 'browser',
      redirectUri: flow.redirectUri,
      accountLabel: exchange.userId ? `OpenRouter ${exchange.userId}` : 'OpenRouter Account',
      planLabel: 'OAuth PKCE',
    };
  }

  private async exchangeGrokCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
    if (!code || !flow.codeVerifier || !flow.clientId || !flow.redirectUri) {
      throw new Error('Super Grok browser authorization requires the one-time code shown by xAI and an active PKCE login flow.');
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

  private async persistAccount(providerId: AccountProviderId, bundle: OAuthSecretBundle): Promise<LlmProviderAccountStatus> {
    const discovery = await this.discoverCatalog(bundle, true);
    if (discovery.models.length === 0) {
      throw new Error('Account provider returned no usable models.');
    }
    await this.saveAccountDiscovery(providerId, bundle, discovery, true);
    this.clearFlows(providerId);
    return this.status(providerId);
  }

  private async saveAccountDiscovery(
    providerId: AccountProviderId,
    bundle: OAuthSecretBundle,
    discovery: AccountCatalogDiscovery,
    publish: boolean,
  ): Promise<void> {
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(bundle),
      discovery.models,
      {
        accountLabel: bundle.accountLabel,
        planLabel: bundle.planLabel,
        oauthExpiresAt: bundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(bundle),
      },
    );
    if (publish && this.catalogPublisher) {
      await this.catalogPublisher(providerId, discovery);
    }
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
      if (!bundle.refreshToken) {
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
          client_id: GROK_OAUTH_CLIENT_ID,
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

    if (bundle.providerId === 'minimax-account') {
      if (!bundle.refreshToken || !bundle.region) return bundle;
      const request = buildMiniMaxRefresh(bundle.region, bundle.refreshToken);
      const payload = await fetchOAuthJson(request.url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: request.body.toString(),
      }) as {
        status?: string;
        access_token?: string;
        refresh_token?: string;
        expired_in?: number | string;
        expires_in?: number | string;
        error?: string;
        base_resp?: { status_msg?: string };
      };
      if (payload.status !== 'success' || !payload.access_token) {
        const error = new Error(
          payload.base_resp?.status_msg || payload.error || 'MiniMax OAuth refresh did not return success.',
        ) as Error & { code?: string };
        error.code = payload.error;
        throw error;
      }
      return {
        ...bundle,
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        refreshToken: payload.refresh_token ?? bundle.refreshToken,
        expiresAt: resolveMiniMaxExpiry(payload.expired_in ?? payload.expires_in),
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

  private async discoverCatalog(bundle: OAuthSecretBundle, allowSeedFallback = false): Promise<AccountCatalogDiscovery> {
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
          return {
            models,
            contributions: parsed.contributions.filter((model) => models.some((entry) => entry.id === model.modelId)),
          };
        }
      } catch (error) {
        if (!allowSeedFallback) throw error;
      }
      delete bundle.copilotModelBilling;
    }
    if (bundle.providerId === 'chatgpt-account') {
      const token = bundle.accessToken ?? bundle.apiKey;
      if (!token) throw new Error('ChatGPT Account OAuth token is missing.');
      try {
        const payload = await fetchJson(
          `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(CHATGPT_CATALOG_CLIENT_VERSION)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              ...(bundle.accountId ? { 'chatgpt-account-id': bundle.accountId } : {}),
            },
          },
        );
        const parsed = parseChatGptAccountCatalog(payload);
        if (parsed.models.length > 0) return parsed;
        throw new Error('ChatGPT Codex catalog returned no agent-routable models.');
      } catch (error) {
        if (!allowSeedFallback) throw error;
      }
    }
    if (bundle.providerId === 'claude-account') {
      const token = bundle.accessToken;
      if (!token) throw new Error('Claude Account OAuth token is missing.');
      try {
        const payload = await fetchJson('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'x-api-key': token,
            'anthropic-version': '2023-06-01',
            ...CLAUDE_ACCOUNT_WIRE_HEADERS,
          },
        });
        const parsed = parseClaudeAccountCatalog(payload);
        if (parsed.models.length > 0) return parsed;
        throw new Error('Claude Account catalog returned no agent-routable models.');
      } catch (error) {
        if (!allowSeedFallback) throw error;
      }
    }
    if (bundle.providerId === 'grok-account') {
      const token = bundle.accessToken ?? bundle.apiKey;
      if (!token) throw new Error('Super Grok OAuth token is missing.');
      const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
      const [builderResult, apiResult] = await Promise.allSettled([
        fetchJson(`${GROK_BUILD_API_BASE_URL}/models`, { method: 'GET', headers }).then(parseGrokBuilderCatalog),
        fetchJson(`${XAI_API_BASE_URL}/models`, { method: 'GET', headers }).then(parseGrokAccountCatalog),
      ]);
      const builder = builderResult.status === 'fulfilled'
        ? builderResult.value
        : { models: [], contributions: [] };
      const api = apiResult.status === 'fulfilled'
        ? apiResult.value
        : { models: [], contributions: [] };
      const parsed = mergeParsedLiveCatalogs(api, builder);
      const sourceDetail = [
        builderResult.status === 'rejected'
          ? `Builder unavailable (${parseProviderError(builderResult.reason)})`
          : `Builder returned ${builder.models.length} agent-routable model(s)`,
        apiResult.status === 'rejected'
          ? `xAI API unavailable (${parseProviderError(apiResult.reason)})`
          : `xAI API returned ${api.models.length} agent-routable model(s)`,
      ].join('; ');
      const partialCatalog = builderResult.status === 'rejected'
        || apiResult.status === 'rejected'
        || builder.models.length === 0
        || api.models.length === 0;
      if (partialCatalog && sourceDetail !== this.lastGrokCatalogSourceDiagnostic) {
        runtimeLogService.log({
          scope: 'app',
          namespace: 'llm',
          severity: parsed.models.length > 0 ? 'warning' : 'error',
          title: 'Super Grok catalog source incomplete',
          summary: parsed.models.length > 0
            ? 'Using the models returned by the available live catalog surface.'
            : 'Neither live catalog surface returned an agent-routable model.',
          detail: sourceDetail,
        });
        this.lastGrokCatalogSourceDiagnostic = sourceDetail;
      } else if (!partialCatalog) {
        this.lastGrokCatalogSourceDiagnostic = undefined;
      }
      if (parsed.models.length === 0) {
        throw new Error(`Super Grok Builder and API catalogs returned no agent-routable models. ${sourceDetail}`);
      }
      return { ...parsed, detail: sourceDetail };
    }
    if (bundle.providerId === 'openrouter') {
      if (!bundle.apiKey) throw new Error('OpenRouter OAuth API key is missing.');
      const payload = await fetchJson('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${bundle.apiKey}` },
      });
      const parsed = parseOpenRouterAccountCatalog(payload);
      if (parsed.models.length === 0) {
        throw new Error('OpenRouter OAuth catalog returned no agent-routable models.');
      }
      return parsed;
    }
    if (bundle.providerId === 'minimax-account') {
      const models = createAccountCatalogModels(bundle.providerId);
      if (models.length === 0 || !bundle.inferenceBaseUrl) {
        throw new Error('MiniMax OAuth is missing its verified seed catalog or regional inference route.');
      }
      return {
        models,
        contributions: models.map((model) => ({
          modelId: model.id,
          label: model.label,
          availability: 'available',
          route: {
            protocol: 'AnthropicMessages',
            baseUrl: bundle.inferenceBaseUrl,
            source: 'model',
          },
        })),
      };
    }
    const models = createAccountCatalogModels(bundle.providerId);
    if (models.length === 0) {
      throw new Error(`Account provider ${bundle.providerId} is missing an app-managed model catalog.`);
    }
    return { models };
  }

  private async revokeGrokBundle(bundle: OAuthSecretBundle): Promise<void> {
    if (bundle.providerId !== 'grok-account') {
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
          client_id: GROK_OAUTH_CLIENT_ID,
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
    for (const flow of this.pendingFlows.values()) {
      if (flow.providerId === providerId && (!flowId || flow.flowId === flowId) && Date.now() <= flow.expiresAt) {
        return flow;
      }
    }
    return null;
  }

  private setFlow(flow: OAuthFlowState): void {
    this.clearFlows(flow.providerId);
    this.pendingFlows.set(flow.flowId, flow);
  }

  private clearFlows(providerId: AccountProviderId): void {
    for (const [flowId, flow] of this.pendingFlows.entries()) {
      if (flow.providerId === providerId) {
        this.closeFlowServer(flow);
        this.pendingFlows.delete(flowId);
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

  private startOpenRouterCallbackServer(flow: OAuthFlowState, challenge: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const callbackPath = `/oauth/openrouter/callback/${flow.flowId}`;
      const server = createServer((request, response) => {
        const baseUrl = flow.redirectUri ?? 'http://127.0.0.1';
        const url = new URL(request.url ?? '/', baseUrl);
        if (url.pathname !== callbackPath) {
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Not found.');
          return;
        }
        const providerError = url.searchParams.get('error');
        const code = url.searchParams.get('code') ?? '';
        if (providerError || !code) {
          flow.error = providerError
            ? `OpenRouter authorization failed: ${providerError}`
            : 'OpenRouter callback did not include an authorization code.';
          response.writeHead(400, { 'Content-Type': 'text/plain' });
          response.end(flow.error);
          this.closeFlowServer(flow);
          return;
        }
        void this.finishLogin({ providerId: flow.providerId, flowId: flow.flowId, code })
          .then((status) => {
            if (!status.connected) {
              response.writeHead(500, { 'Content-Type': 'text/plain' });
              response.end(status.error ?? status.message ?? 'OpenRouter sign-in failed.');
              return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end('<html><body>RDC Agent OpenRouter sign-in complete. You can return to the app.</body></html>');
          })
          .catch((error) => {
            flow.error = parseProviderError(error);
            response.writeHead(500, { 'Content-Type': 'text/plain' });
            response.end(flow.error);
          })
          .finally(() => this.closeFlowServer(flow));
      });
      flow.server = server;
      server.on('error', (error) => {
        flow.error = parseProviderError(error);
        this.closeFlowServer(flow);
        this.pendingFlows.delete(flow.flowId);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('OpenRouter callback server did not expose a loopback port.'));
          return;
        }
        flow.redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
        flow.authUrl = buildOpenRouterAuthorizationUrl(flow.redirectUri, challenge);
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
        this.pendingFlows.delete(flow.flowId);
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
    if (!url || !shouldOpenSystemBrowser()) {
      return;
    }
    await shell.openExternal(url);
  }
}

export const providerAccountAuthService = new ProviderAccountAuthService();
