import { randomUUID } from 'crypto';
import { SUPER_GROK_OAUTH_REDIRECT_URI } from '@shared/constants/llm';
import type { LlmProviderAccountDiagnostic, LlmProviderModel } from '@shared/types/settings';
import { getLoadedProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { mergeParsedLiveCatalogs, parseGrokAccountCatalog, parseGrokBuilderCatalog } from '../LiveProviderCatalogParsers';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { GROK_BUILD_API_BASE_URL, GROK_OAUTH_CLIENT_ID, XAI_API_BASE_URL } from './oauthConstants';
import {
  appendParams,
  createFormBody,
  createPkce,
  fetchJson,
  fetchOAuthJson,
  isTestMode,
  parseProviderError,
  readString,
  wait,
} from './oauthHttp';
import {
  createGrokOAuthFailureDiagnostic,
  fetchGrokOAuthMetadata,
  GrokOAuthDiagnosticError,
  renderGrokOAuthDiagnosticMessage,
  resolveGrokOAuthDiagnostic,
  resolveGrokOAuthScope,
} from './grokOAuth';

export async function startGrokBrowserLogin(
  clientId: string,
  setFlow: (flow: OAuthFlowState) => void,
  openExternal: (url?: string) => Promise<void>,
): Promise<OAuthFlowState> {
  const metadata = await fetchGrokOAuthMetadata();
  const scope = resolveGrokOAuthScope(metadata);
  const { verifier, challenge } = createPkce();
  const flow: OAuthFlowState = {
    providerId: 'grok-account',
    flowId: randomUUID(),
    state: randomUUID(),
    codeVerifier: verifier,
    authUrl: appendParams(metadata.authorizationEndpoint, {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: SUPER_GROK_OAUTH_REDIRECT_URI,
      scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: randomUUID(),
    }),
    clientId,
    authorizationMode: 'browser',
    requestedScopes: scope,
    redirectUri: SUPER_GROK_OAUTH_REDIRECT_URI,
    tokenEndpoint: metadata.tokenEndpoint,
    userinfoEndpoint: metadata.userinfoEndpoint,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  setFlow(flow);
  void openExternal(flow.authUrl);
  return flow;
}

export async function startGrokDeviceLogin(
  clientId: string,
  setFlow: (flow: OAuthFlowState) => void,
  openExternal: (url?: string) => Promise<void>,
  onComplete: (bundle: OAuthSecretBundle) => Promise<void>,
  onError: (flow: OAuthFlowState, message: string, diagnostic?: LlmProviderAccountDiagnostic) => void,
): Promise<OAuthFlowState> {
  const metadata = await fetchGrokOAuthMetadata();
  const scope = resolveGrokOAuthScope(metadata);
  const payload = await fetchOAuthJson(metadata.deviceAuthorizationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createFormBody({ client_id: clientId, scope }),
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
  setFlow(flow);
  void openExternal(flow.authUrl);
  void pollGrokDevice(flow).then(onComplete).catch((error) => {
    const diagnostic = resolveGrokOAuthDiagnostic(error, 'device', flow.requestedScopes, flow.redirectUri);
    onError(flow, renderGrokOAuthDiagnosticMessage(diagnostic), diagnostic);
  });
  return flow;
}

export async function exchangeGrokCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
  if (!code || !flow.codeVerifier || !flow.clientId || !flow.redirectUri) {
    throw new Error('Super Grok browser authorization requires the one-time code shown by xAI and an active PKCE login flow.');
  }
  const tokenEndpoint = flow.tokenEndpoint ?? (await fetchGrokOAuthMetadata()).tokenEndpoint;
  const payload = await fetchOAuthJson(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  const account = await fetchGrokUserInfo(payload.access_token, flow.userinfoEndpoint);
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

export async function pollGrokDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    const account = await fetchGrokUserInfo(payload.access_token, flow.userinfoEndpoint);
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

export async function fetchGrokUserInfo(accessToken: string, userinfoEndpoint?: string): Promise<{ accountId?: string; accountLabel?: string }> {
  try {
    const endpoint = userinfoEndpoint ?? (await fetchGrokOAuthMetadata()).userinfoEndpoint;
    const payload = await fetchJson(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
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

export async function refreshGrokBundle(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
  if (!bundle.refreshToken) {
    return bundle;
  }
  const metadata = await fetchGrokOAuthMetadata();
  const payload = await fetchOAuthJson(metadata.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

export async function revokeGrokBundle(bundle: OAuthSecretBundle): Promise<void> {
  const token = bundle.refreshToken ?? bundle.accessToken ?? bundle.apiKey;
  if (!token) {
    return;
  }
  try {
    const metadata = await fetchGrokOAuthMetadata();
    await fetchOAuthJson(metadata.revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

export async function discoverGrokCatalog(
  bundle: OAuthSecretBundle,
  lastSourceDiagnostic: string | undefined,
  setLastSourceDiagnostic: (value: string | undefined) => void,
): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[]; detail?: string }> {
  const token = bundle.accessToken ?? bundle.apiKey;
  if (!token) throw new Error('Super Grok OAuth token is missing.');
  const grokSurface = getLoadedProviderSurface('grok-account');
  if (!grokSurface) throw new Error('Super Grok compiled surface is unavailable.');
  const builderRoute = grokSurface.routes.find((route) => route.protocol === 'OpenAIResponses');
  const builderHeaders = {
    Accept: 'application/json',
    ...(builderRoute?.headers ?? {}),
    Authorization: `Bearer ${token}`,
  };
  const apiHeaders = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  const [builderResult, apiResult] = await Promise.allSettled([
    fetchJson(`${GROK_BUILD_API_BASE_URL}/models`, { method: 'GET', headers: builderHeaders })
      .then((payload) => parseGrokBuilderCatalog(payload, grokSurface)),
    fetchJson(`${XAI_API_BASE_URL}/models`, { method: 'GET', headers: apiHeaders }).then(parseGrokAccountCatalog),
  ]);
  const builder = builderResult.status === 'fulfilled'
    ? builderResult.value
    : { models: [], contributions: [], diagnostic: undefined };
  const api = apiResult.status === 'fulfilled'
    ? apiResult.value
    : { models: [], contributions: [] };
  const parsed = mergeParsedLiveCatalogs(api, builder);
  const builderDiagnostic = builder.diagnostic
    ? `envelope=${builder.diagnostic.envelopeKind}, candidates=${builder.diagnostic.candidateCount}, `
      + `admitted=${builder.diagnostic.admittedCount}, filtered=${JSON.stringify(builder.diagnostic.filtered)}`
    : 'envelope=unknown';
  const sourceDetail = [
    builderResult.status === 'rejected'
      ? `Builder unavailable (${parseProviderError(builderResult.reason)})`
      : `Builder returned ${builder.models.length} agent-routable model(s) (${builderDiagnostic})`,
    apiResult.status === 'rejected'
      ? `xAI API unavailable (${parseProviderError(apiResult.reason)})`
      : `xAI API returned ${api.models.length} agent-routable model(s)`,
  ].join('; ');
  const partialCatalog = builderResult.status === 'rejected'
    || apiResult.status === 'rejected'
    || builder.models.length === 0
    || api.models.length === 0;
  if (partialCatalog && sourceDetail !== lastSourceDiagnostic) {
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
    setLastSourceDiagnostic(sourceDetail);
  } else if (!partialCatalog) {
    setLastSourceDiagnostic(undefined);
  }
  if (parsed.models.length === 0) {
    throw new Error(`Super Grok Builder and API catalogs returned no agent-routable models. ${sourceDetail}`);
  }
  return { ...parsed, detail: sourceDetail };
}
