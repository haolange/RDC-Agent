import { randomUUID } from 'crypto';
import type { LlmProviderModel } from '@shared/types/settings';
import { CLAUDE_ACCOUNT_WIRE_HEADERS } from '../ClaudeWire';
import { parseClaudeAccountCatalog } from '../LiveProviderCatalogParsers';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { CLAUDE_CLIENT_ID } from './oauthConstants';
import { appendParams, createPkce, fetchJson } from './oauthHttp';

export function startClaudeLogin(setFlow: (flow: OAuthFlowState) => void): OAuthFlowState {
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
  setFlow(flow);
  return flow;
}

export async function exchangeClaudeCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
  if (!code || !flow.codeVerifier) {
    throw new Error('Authorization code is required.');
  }
  const payload = await fetchJson('https://platform.claude.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RDC-Agent' },
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

export async function refreshClaudeBundle(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
  const payload = await fetchJson('https://platform.claude.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RDC-Agent' },
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

export async function discoverClaudeCatalog(bundle: OAuthSecretBundle): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[] }> {
  const token = bundle.accessToken;
  if (!token) throw new Error('Claude Account OAuth token is missing.');
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
}
