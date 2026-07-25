import { randomUUID } from 'crypto';
import type { LlmProviderModel } from '@shared/types/settings';
import { isAdmittedDiscoveredModel } from '../DiscoveryAdmission';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { NOUS_INFERENCE_BASE_URL, NOUS_OAUTH_CLIENT_ID, NOUS_OAUTH_SCOPE, NOUS_PORTAL_BASE_URL } from './oauthConstants';
import { createFormBody, fetchJson, fetchOAuthJson, isTestMode, readString, wait } from './oauthHttp';

const isAgentRoutableAccountModel = (modelId: string): boolean => isAdmittedDiscoveredModel(modelId);

export async function startNousLogin(
  setFlow: (flow: OAuthFlowState) => void,
  openExternal: (url?: string) => Promise<void>,
  onComplete: (bundle: OAuthSecretBundle) => Promise<void>,
  onError: (flow: OAuthFlowState, message: string) => void,
): Promise<OAuthFlowState> {
  const payload = await fetchOAuthJson(`${NOUS_PORTAL_BASE_URL}/api/oauth/device/code`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createFormBody({ client_id: NOUS_OAUTH_CLIENT_ID, scope: NOUS_OAUTH_SCOPE }),
  }) as Record<string, unknown>;
  if (typeof payload.error === 'string') throw new Error(String(payload.error_description ?? payload.error));
  const flow: OAuthFlowState = {
    providerId: 'nous',
    flowId: randomUUID(),
    state: randomUUID(),
    deviceCode: readString(payload.device_code),
    userCode: readString(payload.user_code),
    verificationUri: readString(payload.verification_uri),
    authUrl: readString(payload.verification_uri_complete),
    intervalSeconds: typeof payload.interval === 'number' ? payload.interval : 5,
    clientId: NOUS_OAUTH_CLIENT_ID,
    authorizationMode: 'device',
    requestedScopes: NOUS_OAUTH_SCOPE,
    tokenEndpoint: `${NOUS_PORTAL_BASE_URL}/api/oauth/token`,
    resourceUrl: NOUS_INFERENCE_BASE_URL,
    expiresAt: Date.now() + ((typeof payload.expires_in === 'number' ? payload.expires_in : 900) * 1000),
  };
  if (!flow.deviceCode || !flow.userCode || !flow.verificationUri || !flow.authUrl) {
    throw new Error('Nous Portal did not return a complete device authorization payload.');
  }
  setFlow(flow);
  void openExternal(flow.authUrl);
  void pollNousDevice(flow).then(onComplete).catch((error) => {
    onError(flow, error instanceof Error ? error.message : String(error));
  });
  return flow;
}

export async function pollNousDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
  if (!flow.deviceCode || !flow.clientId || !flow.tokenEndpoint) {
    throw new Error('Nous Portal device authorization is missing client, device code, or token endpoint.');
  }
  let intervalSeconds = flow.intervalSeconds ?? 5;
  let delayBeforePoll = !isTestMode();
  for (;;) {
    if (Date.now() > flow.expiresAt) throw new Error('Nous Portal authorization code expired.');
    if (delayBeforePoll) await wait(intervalSeconds * 1000);
    delayBeforePoll = true;
    const payload = await fetchOAuthJson(flow.tokenEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createFormBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: flow.clientId,
        device_code: flow.deviceCode,
      }),
    }) as Record<string, unknown>;
    if (payload.error === 'authorization_pending') { delete flow.error; continue; }
    if (payload.error === 'slow_down') { delete flow.error; intervalSeconds += 1; continue; }
    if (typeof payload.error === 'string') throw new Error(String(payload.error_description ?? payload.error));
    const accessToken = readString(payload.access_token);
    if (!accessToken) throw new Error('Nous Portal OAuth did not return an access token.');
    return {
      providerId: 'nous',
      accessToken,
      apiKey: accessToken,
      refreshToken: readString(payload.refresh_token),
      authorizationMode: 'device',
      requestedScopes: readString(payload.scope) ?? flow.requestedScopes ?? NOUS_OAUTH_SCOPE,
      resourceUrl: readString(payload.inference_base_url) ?? flow.resourceUrl ?? NOUS_INFERENCE_BASE_URL,
      expiresAt: new Date(Date.now() + ((typeof payload.expires_in === 'number' ? payload.expires_in : 3600) * 1000)).toISOString(),
      accountLabel: 'Nous Portal',
      planLabel: readString(payload.scope) ?? NOUS_OAUTH_SCOPE,
    };
  }
}

export async function refreshNousBundle(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
  if (!bundle.refreshToken) return bundle;
  const payload = await fetchOAuthJson(`${NOUS_PORTAL_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-nous-refresh-token': bundle.refreshToken,
    },
    body: createFormBody({ grant_type: 'refresh_token', client_id: NOUS_OAUTH_CLIENT_ID }),
  }) as Record<string, unknown>;
  if (typeof payload.error === 'string') throw new Error(String(payload.error_description ?? payload.error));
  const accessToken = readString(payload.access_token);
  if (!accessToken) throw new Error('Nous Portal OAuth refresh did not return an access token.');
  return {
    ...bundle,
    accessToken,
    apiKey: accessToken,
    refreshToken: readString(payload.refresh_token) ?? bundle.refreshToken,
    requestedScopes: readString(payload.scope) ?? bundle.requestedScopes,
    resourceUrl: readString(payload.inference_base_url) ?? bundle.resourceUrl ?? NOUS_INFERENCE_BASE_URL,
    expiresAt: new Date(Date.now() + ((typeof payload.expires_in === 'number' ? payload.expires_in : 3600) * 1000)).toISOString(),
  };
}

export async function discoverNousCatalog(bundle: OAuthSecretBundle): Promise<{ models: LlmProviderModel[] }> {
  const token = bundle.accessToken ?? bundle.apiKey;
  if (!token) throw new Error('Nous Portal OAuth token is missing.');
  const baseUrl = (bundle.resourceUrl ?? NOUS_INFERENCE_BASE_URL).replace(/\/+$/u, '');
  const payload = await fetchJson(`${baseUrl}/models`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const seen = new Set<string>();
  const models = data.flatMap((entry): LlmProviderModel[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = readString(item.id);
    if (!id || seen.has(id) || id.toLowerCase().includes('hermes') || !isAgentRoutableAccountModel(id)) return [];
    seen.add(id);
    return [{ id, label: readString(item.name) ?? readString(item.display_name) ?? id, enabled: true }];
  });
  if (models.length === 0) throw new Error('Nous Portal catalog returned no agent-routable models.');
  return { models };
}
