import { randomUUID } from 'crypto';
import { createServer } from 'http';
import type { LlmProviderModel } from '@shared/types/settings';
import { parseChatGptAccountCatalog } from '../LiveProviderCatalogParsers';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { CHATGPT_CALLBACK_PORT, CHATGPT_CLIENT_ID, CHATGPT_CATALOG_CLIENT_VERSION } from './oauthConstants';
import { appendParams, createPkce, extractChatGptAccountId, fetchJson } from './oauthHttp';

export async function startChatGptLogin(
  setFlow: (flow: OAuthFlowState) => void,
  startCallbackServer: (flow: OAuthFlowState) => Promise<void>,
  openExternal: (url?: string) => Promise<void>,
): Promise<OAuthFlowState> {
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
  setFlow(flow);
  await startCallbackServer(flow);
  void openExternal(flow.authUrl);
  return flow;
}

export async function exchangeChatGptCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
  if (!code || !flow.codeVerifier) throw new Error('Authorization code is required.');
  const tokenPayload = await fetchJson('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CHATGPT_CLIENT_ID,
      code,
      redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
      code_verifier: flow.codeVerifier,
    }).toString(),
  }) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
  if (!tokenPayload.access_token) throw new Error('OpenAI OAuth did not return an access token.');
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

export async function refreshChatGptBundle(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle> {
  const payload = await fetchJson('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CHATGPT_CLIENT_ID,
      refresh_token: bundle.refreshToken ?? '',
    }).toString(),
  }) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('OpenAI OAuth refresh did not return an access token.');
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

export async function discoverChatGptCatalog(bundle: OAuthSecretBundle): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[] }> {
  const token = bundle.accessToken ?? bundle.apiKey;
  if (!token) throw new Error('ChatGPT Account OAuth token is missing.');
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
}

export function startChatGptCallbackServer(
  flow: OAuthFlowState,
  finishLogin: (flowId: string, code: string) => Promise<{ connected: boolean; error?: string; message?: string }>,
  closeFlowServer: (flow: OAuthFlowState) => void,
  clearFlow: (flowId: string) => void,
): Promise<void> {
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
      void finishLogin(flow.flowId, code)
        .then((status) => {
          response.writeHead(status.connected ? 200 : 500, { 'Content-Type': status.connected ? 'text/html' : 'text/plain' });
          response.end(status.connected
            ? '<html><body>RDC Agent sign-in complete. You can return to the app.</body></html>'
            : (status.error ?? status.message ?? 'ChatGPT sign-in failed.'));
        })
        .catch((error) => {
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end(error instanceof Error ? error.message : String(error));
        })
        .finally(() => closeFlowServer(flow));
    });
    flow.server = server;
    server.on('error', (error) => {
      flow.error = error instanceof Error ? error.message : String(error);
      closeFlowServer(flow);
      clearFlow(flow.flowId);
      if (!settled) { settled = true; reject(error); }
    });
    server.listen(CHATGPT_CALLBACK_PORT, '127.0.0.1', () => { settled = true; resolve(); });
  });
}
