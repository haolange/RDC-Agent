import {
  discoverChatGptCatalog,
  exchangeChatGptCode,
  refreshChatGptBundle,
  startChatGptCallbackServer,
  startChatGptLogin,
} from './chatGptAccountOAuth';
import {
  discoverClaudeCatalog,
  exchangeClaudeCode,
  refreshClaudeBundle,
  startClaudeLogin,
} from './claudeAccountOAuth';
import {
  discoverCopilotCatalog,
  refreshCopilotBundle,
  startGitHubCopilotLogin,
} from './copilotAccountOAuth';
import {
  discoverGrokCatalog,
  exchangeGrokCode,
  refreshGrokBundle,
  revokeGrokBundle,
  startGrokBrowserLogin,
} from './grokAccountOAuth';
import { resolveGrokOAuthDiagnostic } from './grokOAuth';
import {
  discoverNousCatalog,
  refreshNousBundle,
  startNousLogin,
} from './nousAccountOAuth';
import {
  discoverOpenRouterCatalog,
  exchangeOpenRouterCode,
  startOpenRouterCallbackServer,
  startOpenRouterLogin,
} from './openRouterAccountOAuth';
import { GROK_OAUTH_CLIENT_ID } from './oauthConstants';
import type { CatalogModelContribution } from '../../provider-catalog/effectiveCatalogTypes';
import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountStatus,
  LlmProviderId,
  LlmProviderModel,
} from '@shared/types/settings';
import type { ProviderAccountFlowId } from '@shared/provider-catalog/implementationRegistry';
import type { OAuthFlowState, OAuthSecretBundle } from './oauthTypes';

export interface AccountCatalogDiscovery {
  models: LlmProviderModel[];
  contributions?: CatalogModelContribution[];
  entitlementContributions?: CatalogModelContribution[];
  detail?: string;
}

/** What the sign-in service lends one start of a flow. */
export interface AccountFlowHost {
  readonly providerId: LlmProviderId;
  setFlow(flow: OAuthFlowState): void;
  openExternal(url?: string): Promise<void>;
  /** Finishes a flow whose browser callback delivered an authorization code. */
  completeWithCode(flowId: string, code: string): Promise<LlmProviderAccountStatus>;
  /** Stores the credentials a background device poll produced for the flow this start registered. */
  persist(bundle: OAuthSecretBundle): Promise<void>;
  /** Records a background failure on the flow so its status reports it. */
  fail(flow: OAuthFlowState, message: string): void;
  closeFlowServer(flow: OAuthFlowState): void;
  forgetFlow(flowId: string): void;
}

/**
 * One account sign-in implementation. A surface selects it with `accountAuth.flow`; everything the
 * service does around it (flow bookkeeping, persistence, refresh ownership, status) is shared.
 */
export interface AccountAuthFlow {
  /** Registers the flow through the host and resolves once the person can act on it. */
  start(host: AccountFlowHost): Promise<void>;
  /** Exchanges an authorization code for credentials; device flows finish through their own poll. */
  exchangeCode?(flow: OAuthFlowState, code: string): Promise<OAuthSecretBundle>;
  refresh?(bundle: OAuthSecretBundle): Promise<OAuthSecretBundle>;
  discover(bundle: OAuthSecretBundle, signal?: AbortSignal): Promise<AccountCatalogDiscovery>;
  revoke?(bundle: OAuthSecretBundle): Promise<void>;
  /** The bundle can be refreshed without signing in again. */
  canRefresh(bundle: OAuthSecretBundle): boolean;
  /** The bundle cannot serve a request until it is refreshed. */
  requiresRefresh?(bundle: OAuthSecretBundle): boolean;
  /** A structured diagnostic for a failed start or finish; other flows report the error text. */
  diagnose?(error: unknown, flow: OAuthFlowState | null): LlmProviderAccountDiagnostic;
}

const hasRefreshToken = (bundle: OAuthSecretBundle): boolean => Boolean(bundle.refreshToken);

function callbackCompletion(host: AccountFlowHost) {
  return async (flowId: string, code: string) => {
    const status = await host.completeWithCode(flowId, code);
    return { connected: status.connected, error: status.error, message: status.message };
  };
}

export const ACCOUNT_AUTH_FLOWS: Readonly<Record<ProviderAccountFlowId, AccountAuthFlow>> = {
  'chatgpt-oauth': {
    async start(host) {
      await startChatGptLogin(
        host.providerId,
        (flow) => host.setFlow(flow),
        (flow) => startChatGptCallbackServer(
          flow,
          callbackCompletion(host),
          (closing) => host.closeFlowServer(closing),
          (flowId) => host.forgetFlow(flowId),
        ),
        (url) => host.openExternal(url),
      );
    },
    exchangeCode: exchangeChatGptCode,
    refresh: refreshChatGptBundle,
    discover: (bundle) => discoverChatGptCatalog(bundle),
    canRefresh: hasRefreshToken,
  },
  'claude-oauth': {
    async start(host) {
      const flow = startClaudeLogin(host.providerId, (next) => host.setFlow(next));
      void host.openExternal(flow.authUrl);
    },
    exchangeCode: exchangeClaudeCode,
    refresh: refreshClaudeBundle,
    discover: (bundle) => discoverClaudeCatalog(bundle),
    canRefresh: hasRefreshToken,
  },
  'copilot-device': {
    async start(host) {
      await startGitHubCopilotLogin(
        host.providerId,
        (flow) => host.setFlow(flow),
        (url) => host.openExternal(url),
        (bundle) => host.persist(bundle),
        (flow, message) => host.fail(flow, message),
      );
    },
    refresh: refreshCopilotBundle,
    discover: (bundle) => discoverCopilotCatalog(bundle),
    canRefresh: (bundle) => Boolean(bundle.accessToken),
    requiresRefresh: (bundle) => !bundle.copilotToken,
  },
  'grok-oauth': {
    async start(host) {
      await startGrokBrowserLogin(
        host.providerId,
        GROK_OAUTH_CLIENT_ID,
        (flow) => host.setFlow(flow),
        (url) => host.openExternal(url),
        async (flow, code) => {
          const status = await host.completeWithCode(flow.flowId, code);
          if (!status.connected) throw new Error(status.error ?? 'Sign-in failed.');
        },
      );
    },
    exchangeCode: exchangeGrokCode,
    refresh: refreshGrokBundle,
    discover: discoverGrokCatalog,
    revoke: revokeGrokBundle,
    canRefresh: hasRefreshToken,
    diagnose: (error, flow) => resolveGrokOAuthDiagnostic(error, 'browser', flow?.requestedScopes, flow?.redirectUri),
  },
  'nous-device': {
    async start(host) {
      await startNousLogin(
        host.providerId,
        (flow) => host.setFlow(flow),
        (url) => host.openExternal(url),
        (bundle) => host.persist(bundle),
        (flow, message) => host.fail(flow, message),
      );
    },
    refresh: refreshNousBundle,
    discover: (bundle) => discoverNousCatalog(bundle),
    canRefresh: hasRefreshToken,
  },
  'openrouter-oauth': {
    async start(host) {
      const flow = await startOpenRouterLogin(
        host.providerId,
        (next) => host.setFlow(next),
        (next, challenge) => startOpenRouterCallbackServer(
          next,
          challenge,
          callbackCompletion(host),
          (closing) => host.closeFlowServer(closing),
          (flowId) => host.forgetFlow(flowId),
        ),
      );
      void host.openExternal(flow.authUrl);
    },
    exchangeCode: exchangeOpenRouterCode,
    discover: (bundle) => discoverOpenRouterCatalog(bundle),
    canRefresh: hasRefreshToken,
  },
};
