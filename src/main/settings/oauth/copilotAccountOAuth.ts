import { randomUUID } from 'crypto';
import type { LlmProviderModel } from '@shared/types/settings';
import { COPILOT_EDITOR_HEADERS, COPILOT_WIRE_HEADERS } from '../CopilotWire';
import { parseCopilotModelCatalog } from '../CopilotBilling';
import { isAdmittedDiscoveredModel } from '../DiscoveryAdmission';
import { getProviderModelDefinitions } from '../../provider-catalog/ProviderCatalogRegistry';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { GITHUB_COPILOT_CLIENT_ID } from './oauthConstants';
import { fetchJson, isTestMode, wait } from './oauthHttp';

const isAgentRoutableAccountModel = (modelId: string): boolean => isAdmittedDiscoveredModel(modelId);

export async function startGitHubCopilotLogin(
  setFlow: (flow: OAuthFlowState) => void,
  openExternal: (url?: string) => Promise<void>,
  onComplete: (bundle: OAuthSecretBundle) => Promise<void>,
  onError: (flow: OAuthFlowState, message: string) => void,
): Promise<OAuthFlowState> {
  const payload = await fetchJson('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_COPILOT_CLIENT_ID, scope: 'read:user' }),
  }) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number };
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
  setFlow(flow);
  if (flow.verificationUri) void openExternal(flow.verificationUri);
  void pollGitHubDevice(flow).then(onComplete).catch((error) => {
    onError(flow, error instanceof Error ? error.message : String(error));
  });
  return flow;
}

export async function pollGitHubDevice(flow: OAuthFlowState): Promise<OAuthSecretBundle> {
  if (!flow.deviceCode) throw new Error('GitHub device code is missing.');
  let intervalSeconds = flow.intervalSeconds ?? 5;
  let delayBeforePoll = !isTestMode();
  for (;;) {
    if (Date.now() > flow.expiresAt) throw new Error('GitHub authorization code expired.');
    if (delayBeforePoll) await wait(intervalSeconds * 1000);
    delayBeforePoll = true;
    const payload = await fetchJson('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    }) as { access_token?: string; error?: string; interval?: number };
    if (payload.error === 'authorization_pending') { delete flow.error; continue; }
    if (payload.error === 'slow_down') { delete flow.error; intervalSeconds += 5; continue; }
    if (payload.error) throw new Error(payload.error);
    if (!payload.access_token) throw new Error('GitHub OAuth did not return an access token.');
    const copilot = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `token ${payload.access_token}`, ...COPILOT_EDITOR_HEADERS },
    }) as { token?: string; expires_at?: number; endpoints?: { api?: string } };
    if (!copilot.token) throw new Error('GitHub Copilot did not return an API token.');
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

export async function refreshCopilotBundle(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
  if (!bundle.accessToken) return bundle;
  const copilot = await fetchJson('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `token ${bundle.accessToken}`, ...COPILOT_EDITOR_HEADERS },
  }) as { token?: string; expires_at?: number; endpoints?: { api?: string } };
  if (!copilot.token) throw new Error('GitHub Copilot did not return an API token.');
  return {
    ...bundle,
    copilotToken: copilot.token,
    copilotApiBaseUrl: copilot.endpoints?.api ?? bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com',
    expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1000).toISOString() : bundle.expiresAt,
  };
}

export async function discoverCopilotCatalog(bundle: OAuthSecretBundle): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[] }> {
  if (!bundle.copilotToken) throw new Error('GitHub Copilot API token is missing.');
  const baseUrl = (bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com').replace(/\/+$/, '');
  const payload = await fetchJson(`${baseUrl}/models`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${bundle.copilotToken}`, ...COPILOT_WIRE_HEADERS },
  });
  const parsed = parseCopilotModelCatalog(payload, baseUrl);
  const internalModelIds = new Set(getProviderModelDefinitions('github-copilot')
    .filter((model) => model.selection.pickerVisibility === 'internal')
    .map((model) => model.modelId));
  const allModels = parsed.models.filter((model) => isAgentRoutableAccountModel(model.id));
  const models = allModels.filter((model) => !internalModelIds.has(model.id));
  if (models.length === 0) {
    delete bundle.copilotModelBilling;
    throw new Error('GitHub Copilot catalog returned no agent-routable models.');
  }
  const retainedModelIds = new Set(allModels.map((model) => model.id));
  bundle.copilotModelBilling = Object.fromEntries(
    Object.entries(parsed.billingByModel).filter(([modelId]) => retainedModelIds.has(modelId)),
  );
  return { models, contributions: parsed.contributions.filter((model) => retainedModelIds.has(model.modelId)) };
}
