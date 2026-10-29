import { randomUUID } from 'crypto';
import { listenGrokCallback } from './grokCallback';
import { verifyGrokIdentity } from './grokIdentity';
import type { LlmProviderModel } from '@shared/types/settings';
import { getLoadedProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { parseGrokBuilderCatalog } from '../LiveProviderCatalogParsers';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { GROK_BUILD_API_BASE_URL, GROK_OAUTH_CLIENT_ID } from './oauthConstants';
import {
  appendParams,
  createFormBody,
  createPkce,
  fetchJson,
  fetchOAuthJson,
  readString,
} from './oauthHttp';
import {
  createGrokOAuthFailureDiagnostic,
  fetchGrokOAuthMetadata,
  GrokOAuthDiagnosticError,
  resolveGrokOAuthScope,
} from './grokOAuth';

export async function startGrokBrowserLogin(
  clientId: string,
  setFlow: (flow: OAuthFlowState) => void,
  openBrowser: (url: string) => Promise<void>,
  complete: (flow: OAuthFlowState, code: string) => Promise<void>,
): Promise<OAuthFlowState> {
  const { verifier, challenge } = createPkce();
  const flow: OAuthFlowState = {
    providerId: 'grok-account', flowId: randomUUID(), state: randomUUID(), nonce: randomUUID(),
    codeVerifier: verifier, clientId, authorizationMode: 'browser',
    expiresAt: Date.now() + 10 * 60 * 1000, abortController: new AbortController(),
  };
  setFlow(flow);
  try {
    const metadata = await fetchGrokOAuthMetadata(flow.abortController?.signal);
    flow.abortController!.signal.throwIfAborted();
    flow.requestedScopes = resolveGrokOAuthScope(metadata);
    flow.tokenEndpoint = metadata.tokenEndpoint;
    flow.userinfoEndpoint = metadata.userinfoEndpoint;
    flow.issuer = metadata.issuer;
    flow.jwksUri = metadata.jwksUri;
    await listenGrokCallback(flow, (code) => complete(flow, code));
    flow.authUrl = appendParams(metadata.authorizationEndpoint, {
      client_id: clientId, response_type: 'code', redirect_uri: flow.redirectUri!,
      scope: flow.requestedScopes, code_challenge: challenge, code_challenge_method: 'S256',
      state: flow.state, nonce: flow.nonce!,
    });
    await openBrowser(flow.authUrl);
    flow.abortController?.signal.throwIfAborted();
    return flow;
  } catch (error) {
    flow.abortController?.abort();
    throw error;
  }
}

export async function exchangeGrokCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
  if (!code || !flow.codeVerifier || !flow.clientId || !flow.redirectUri) {
    throw new Error('Grok authorization requires an automatic callback and an active PKCE login flow.');
  }
  const tokenEndpoint = flow.tokenEndpoint ?? (await fetchGrokOAuthMetadata()).tokenEndpoint;
  const payload = await fetchOAuthJson(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: flow.abortController?.signal,
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
  await verifyGrokIdentity(payload.id_token, flow);
  const account = await fetchGrokUserInfo(payload.access_token, flow.userinfoEndpoint, flow.abortController?.signal);
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
    accountLabel: account.accountLabel ?? 'Grok account',
  };
}

export async function fetchGrokUserInfo(accessToken: string, userinfoEndpoint?: string, signal?: AbortSignal): Promise<{ accountId?: string; accountLabel?: string }> {
  try {
    const endpoint = userinfoEndpoint ?? (await fetchGrokOAuthMetadata()).userinfoEndpoint;
    const payload = await fetchJson(endpoint, {
      method: 'GET',
      signal,
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
  signal?: AbortSignal,
): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[]; detail?: string }> {
  const token = bundle.accessToken ?? bundle.apiKey;
  if (!token) throw new Error('Grok subscription token is missing. Sign in again.');
  const surface = getLoadedProviderSurface('grok-account');
  if (!surface) throw new Error('Grok subscription catalog is unavailable.');
  const payload = await fetchJson(`${GROK_BUILD_API_BASE_URL}/models`, {
    method: 'GET', signal, headers: { Accept: 'application/json',
      ...(surface.routes.find((route) => route.protocol === 'OpenAIResponses')?.headers ?? {}),
      Authorization: `Bearer ${token}` },
  });
  const parsed = parseGrokBuilderCatalog(payload, surface);
  if (!parsed.models.length) throw new Error('Grok subscription returned no supported agent models. Check account access or sign in again.');
  return { ...parsed, detail: 'Grok subscription model catalog' };
}
