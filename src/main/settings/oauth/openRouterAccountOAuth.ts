import { randomUUID } from 'crypto';
import { createServer } from 'http';
import type { LlmProviderModel } from '@shared/types/settings';
import { getLoadedProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { parseOpenRouterAccountCatalog } from '../LiveProviderCatalogParsers';
import { buildOpenRouterAuthorizationUrl, buildOpenRouterExchange, createPkcePair, parseOpenRouterExchange } from '../LiveProviderOAuthContracts';
import type { CatalogModelContribution } from '../effectiveCatalogTypes';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';
import { fetchJson } from './oauthHttp';

export async function startOpenRouterLogin(
  setFlow: (flow: OAuthFlowState) => void,
  startCallbackServer: (flow: OAuthFlowState, challenge: string) => Promise<void>,
): Promise<OAuthFlowState> {
  const { verifier, challenge } = createPkcePair();
  const flow: OAuthFlowState = {
    providerId: 'openrouter',
    flowId: randomUUID(),
    state: randomUUID(),
    codeVerifier: verifier,
    authorizationMode: 'browser',
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  setFlow(flow);
  await startCallbackServer(flow, challenge);
  return flow;
}

export async function exchangeOpenRouterCode(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle> {
  if (!code || !flow.codeVerifier) throw new Error('OpenRouter authorization code is required.');
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

export async function discoverOpenRouterCatalog(bundle: OAuthSecretBundle): Promise<{ models: LlmProviderModel[]; contributions?: CatalogModelContribution[] }> {
  if (!bundle.apiKey) throw new Error('OpenRouter OAuth API key is missing.');
  const payload = await fetchJson('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${bundle.apiKey}` },
  });
  const surface = getLoadedProviderSurface('openrouter');
  if (!surface) throw new Error('OpenRouter compiled surface is unavailable.');
  const parsed = parseOpenRouterAccountCatalog(payload, surface);
  if (parsed.models.length === 0) throw new Error('OpenRouter OAuth catalog returned no agent-routable models.');
  return parsed;
}

export function startOpenRouterCallbackServer(
  flow: OAuthFlowState,
  challenge: string,
  finishLogin: (flowId: string, code: string) => Promise<{ connected: boolean; error?: string; message?: string }>,
  closeFlowServer: (flow: OAuthFlowState) => void,
  clearFlow: (flowId: string) => void,
): Promise<void> {
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
        closeFlowServer(flow);
        return;
      }
      void finishLogin(flow.flowId, code)
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
          flow.error = error instanceof Error ? error.message : String(error);
          response.writeHead(500, { 'Content-Type': 'text/plain' });
          response.end(flow.error);
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
