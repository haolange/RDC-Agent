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
import { settingsService } from './SettingsService';
import { oauthRefreshManager } from './OAuthRefreshManager';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import type { CatalogModelContribution } from './effectiveCatalogTypes';
import {
  discoverChatGptCatalog,
  exchangeChatGptCode,
  refreshChatGptBundle,
  startChatGptCallbackServer,
  startChatGptLogin,
} from './oauth/chatGptAccountOAuth';
import {
  discoverClaudeCatalog,
  exchangeClaudeCode,
  refreshClaudeBundle,
  startClaudeLogin,
} from './oauth/claudeAccountOAuth';
import {
  discoverCopilotCatalog,
  pollGitHubDevice,
  refreshCopilotBundle,
  startGitHubCopilotLogin,
} from './oauth/copilotAccountOAuth';
import {
  discoverGrokCatalog,
  exchangeGrokCode,
  pollGrokDevice,
  refreshGrokBundle,
  revokeGrokBundle,
  startGrokBrowserLogin,
  startGrokDeviceLogin,
} from './oauth/grokAccountOAuth';
import {
  createGrokOAuthStartupDiagnostic,
  renderGrokOAuthDiagnosticMessage,
  resolveGrokOAuthDiagnostic,
} from './oauth/grokOAuth';
import {
  discoverNousCatalog,
  pollNousDevice,
  refreshNousBundle,
  startNousLogin,
} from './oauth/nousAccountOAuth';
import {
  discoverOpenRouterCatalog,
  exchangeOpenRouterCode,
  startOpenRouterCallbackServer,
  startOpenRouterLogin,
} from './oauth/openRouterAccountOAuth';
import { GROK_OAUTH_CLIENT_ID } from './oauth/oauthConstants';
import { parseProviderError, shouldOpenSystemBrowser } from './oauth/oauthHttp';
import type { AccountProviderId, OAuthFlowState, OAuthSecretBundle } from './oauth/oauthTypes';
import { isAccountProviderId } from './oauth/oauthTypes';

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

const canRefreshBundle = (bundle: OAuthSecretBundle): boolean => {
  if (bundle.providerId === 'grok-account') {
    return Boolean(bundle.refreshToken);
  }
  return Boolean(bundle.refreshToken || (bundle.providerId === 'github-copilot' && bundle.accessToken));
};

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
  if (providerId === 'openrouter') return 'Waiting for OpenRouter browser authorization.';
  if (providerId === 'nous') return 'Waiting for Nous Portal device-code authorization.';
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
    try {
      if (providerId === 'claude-account') {
        startClaudeLogin((flow) => this.setFlow(flow));
        void this.openExternal(this.findFlow(providerId)?.authUrl);
        return this.status(providerId);
      }
      if (providerId === 'chatgpt-account') {
        await startChatGptLogin(
          (flow) => this.setFlow(flow),
          (flow) => startChatGptCallbackServer(
            flow,
            async (flowId, code) => {
              const status = await this.finishLoginInternal('chatgpt-account', flowId, code);
              return { connected: status.connected, error: status.error, message: status.message };
            },
            (flow) => this.closeFlowServer(flow),
            (flowId) => this.pendingFlows.delete(flowId),
          ),
          (url) => this.openExternal(url),
        );
        return this.status(providerId);
      }
      if (providerId === 'github-copilot') {
        await startGitHubCopilotLogin(
          (flow) => this.setFlow(flow),
          (url) => this.openExternal(url),
          async (bundle) => { await this.persistAccount(providerId, bundle); },
          (flow, message) => { flow.error = message; },
        );
        return this.status(providerId);
      }
      if (providerId === 'grok-account') {
        const mode: LlmProviderAccountLoginMode = request.accountLoginMode === 'device' ? 'device' : 'browser';
        if (mode === 'device') {
          await startGrokDeviceLogin(
            GROK_OAUTH_CLIENT_ID,
            (flow) => this.setFlow(flow),
            (url) => this.openExternal(url),
            async (bundle) => { await this.persistAccount(providerId, bundle); },
            (flow, message, diagnostic) => { flow.error = message; flow.diagnostic = diagnostic; },
          );
        } else {
          await startGrokBrowserLogin(GROK_OAUTH_CLIENT_ID, (flow) => this.setFlow(flow), (url) => this.openExternal(url));
          void this.openExternal(this.findFlow(providerId)?.authUrl);
        }
        return this.status(providerId);
      }
      if (providerId === 'nous') {
        await startNousLogin(
          (flow) => this.setFlow(flow),
          (url) => this.openExternal(url),
          async (bundle) => { await this.persistAccount(providerId, bundle); },
          (flow, message) => { flow.error = message; },
        );
        return this.status(providerId);
      }
      if (providerId === 'openrouter') {
        const flow = await startOpenRouterLogin(
          (nextFlow) => this.setFlow(nextFlow),
          (nextFlow, challenge) => startOpenRouterCallbackServer(
            nextFlow,
            challenge,
            async (flowId, code) => {
              const status = await this.finishLoginInternal('openrouter', flowId, code);
              return { connected: status.connected, error: status.error, message: status.message };
            },
            (nextFlow) => this.closeFlowServer(nextFlow),
            (flowId) => this.pendingFlows.delete(flowId),
          ),
        );
        void this.openExternal(flow.authUrl);
        return this.status(providerId);
      }
    } catch (error) {
      if (providerId === 'grok-account') {
        const diagnostic = resolveGrokOAuthDiagnostic(error, request.accountLoginMode === 'device' ? 'device' : 'browser');
        return this.status(providerId, renderGrokOAuthDiagnosticMessage(diagnostic), 'failed', diagnostic);
      }
      return this.status(providerId, parseProviderError(error), 'failed');
    }
    return this.status(providerId, 'Provider does not support account login.', 'failed');
  }

  async finishLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    return this.finishLoginInternal(request.providerId, request.flowId ?? '', request.code?.trim() ?? '');
  }

  private async finishLoginInternal(
    providerId: LlmProviderId,
    flowId: string,
    code: string,
  ): Promise<LlmProviderAccountStatus> {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, 'Provider does not support account login.');
    }
    const flow = this.findFlow(providerId, flowId || undefined);
    if (!flow) {
      return this.status(providerId, 'Login flow expired or was not started.', 'failed');
    }

    try {
      let bundle: OAuthSecretBundle;
      if (providerId === 'claude-account') {
        bundle = await exchangeClaudeCode(flow, code);
      } else if (providerId === 'chatgpt-account') {
        bundle = await exchangeChatGptCode(flow, code);
      } else if (providerId === 'github-copilot') {
        bundle = await pollGitHubDevice(flow);
      } else if (providerId === 'grok-account') {
        bundle = flow.authorizationMode === 'browser'
          ? await exchangeGrokCode(flow, code)
          : await pollGrokDevice(flow);
      } else if (providerId === 'nous') {
        bundle = await pollNousDevice(flow);
      } else if (providerId === 'openrouter') {
        bundle = await exchangeOpenRouterCode(flow, code);
      } else {
        return this.status(providerId, 'Provider does not support account login.', 'failed');
      }
      return await this.persistAccount(providerId, bundle);
    } catch (error) {
      if (providerId === 'grok-account') {
        const diagnostic = createGrokOAuthStartupDiagnostic(
          error,
          flow.authorizationMode === 'device' ? 'device' : 'browser',
          flow.requestedScopes,
          flow.redirectUri,
        );
        flow.error = renderGrokOAuthDiagnosticMessage(diagnostic);
        flow.diagnostic = diagnostic;
        return this.status(providerId, flow.error, 'failed', diagnostic);
      }
      flow.error = parseProviderError(error);
      return this.status(providerId, flow.error, 'failed');
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

    await loadProviderSurface(providerId);
    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const refreshedAt = provider?.lastModelRefreshAt ? Date.parse(provider.lastModelRefreshAt) : Number.NaN;
    const catalogIsFresh = Number.isFinite(refreshedAt) && Date.now() - refreshedAt < 5 * 60 * 1000;
    if (JSON.stringify(activeBundle) === JSON.stringify(bundle) && catalogIsFresh) {
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
    const authenticated = Boolean(
      provider?.isConfigured
      && provider.status === 'verified'
      && (providerId !== 'openrouter' || provider.authMode === 'account'),
    );
    const connected = authenticated && forcedState !== 'failed' && !flow?.error;
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
        void revokeGrokBundle(bundle);
      }
      settingsService.disconnectProvider(providerId, 'account');
    }
    return this.status(providerId);
  }

  private async persistAccount(providerId: AccountProviderId, bundle: OAuthSecretBundle): Promise<LlmProviderAccountStatus> {
    const discovery = await this.discoverCatalog(bundle);
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
      return refreshCopilotBundle(bundle);
    }
    if (bundle.providerId === 'grok-account') {
      return refreshGrokBundle(bundle);
    }
    if (bundle.providerId === 'nous') {
      return refreshNousBundle(bundle);
    }
    if (bundle.providerId === 'claude-account') {
      return refreshClaudeBundle(bundle);
    }
    if (bundle.providerId === 'chatgpt-account') {
      return refreshChatGptBundle(bundle);
    }
    return bundle;
  }

  private async discoverCatalog(bundle: OAuthSecretBundle): Promise<AccountCatalogDiscovery> {
    await loadProviderSurface(bundle.providerId);
    if (bundle.providerId === 'github-copilot') {
      return discoverCopilotCatalog(bundle);
    }
    if (bundle.providerId === 'chatgpt-account') {
      return discoverChatGptCatalog(bundle);
    }
    if (bundle.providerId === 'claude-account') {
      return discoverClaudeCatalog(bundle);
    }
    if (bundle.providerId === 'grok-account') {
      return discoverGrokCatalog(
        bundle,
        this.lastGrokCatalogSourceDiagnostic,
        (value) => { this.lastGrokCatalogSourceDiagnostic = value; },
      );
    }
    if (bundle.providerId === 'nous') {
      return discoverNousCatalog(bundle);
    }
    if (bundle.providerId === 'openrouter') {
      return discoverOpenRouterCatalog(bundle);
    }
    throw new Error(`Account provider ${bundle.providerId} has no live Catalog implementation.`);
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

  private async openExternal(url?: string): Promise<void> {
    if (!url || !shouldOpenSystemBrowser()) {
      return;
    }
    await shell.openExternal(url);
  }
}

export const providerAccountAuthService = new ProviderAccountAuthService();