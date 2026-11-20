import { openExternalHttps } from '../../window/rendererTrust';
import type { ProviderAccountAuth } from '@shared/provider-catalog/catalogManifestSchema';
import type {
  LlmProviderAccountDiagnostic,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountStatus,
  LlmProviderId,
} from '@shared/types/settings';
import { settingsService } from '../settings-core/SettingsService';
import { oauthRefreshManager } from './OAuthRefreshManager';
import { getProviderAccountAuth, loadProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import {
  ACCOUNT_AUTH_FLOWS,
  type AccountAuthFlow,
  type AccountCatalogDiscovery,
  type AccountFlowHost,
} from './oauth/accountAuthFlows';
import { parseProviderError, renderAccountDiagnosticMessage, shouldOpenSystemBrowser } from './oauth/oauthHttp';
import type { OAuthFlowState, OAuthSecretBundle } from './oauth/oauthTypes';

export type { AccountCatalogDiscovery } from './oauth/accountAuthFlows';

type AccountCatalogPublisher = (
  providerId: LlmProviderId,
  discovery: AccountCatalogDiscovery,
) => Promise<void>;

interface AccountSignIn {
  accountAuth: ProviderAccountAuth;
  flow: AccountAuthFlow;
}

const NOT_SUPPORTED = 'Provider does not support account login.';

/** The surface's account sign-in, resolved from its manifest; null for surfaces without one. */
function accountSignIn(providerId: LlmProviderId): AccountSignIn | null {
  const accountAuth = getProviderAccountAuth(providerId);
  return accountAuth ? { accountAuth, flow: ACCOUNT_AUTH_FLOWS[accountAuth.flow] } : null;
}

function pendingAuthorizationMessage(accountAuth: ProviderAccountAuth): string {
  if (accountAuth.loginMode === 'device') return 'Waiting for device-code authorization.';
  return accountAuth.codeInput
    ? 'Complete sign-in in your browser, then paste the authorization code.'
    : 'Complete sign-in in your browser, then return to RDC Agent.';
}

export class ProviderAccountAuthService {
  private catalogPublisher?: AccountCatalogPublisher;
  private readonly pendingFlows = new Map<string, OAuthFlowState>();

  setCatalogPublisher(publisher?: AccountCatalogPublisher): void {
    this.catalogPublisher = publisher;
  }

  async startLogin(request: LlmProviderAccountLoginStartRequest): Promise<LlmProviderAccountStatus> {
    const providerId = request.providerId;
    const signIn = accountSignIn(providerId);
    if (!signIn) return this.status(providerId, NOT_SUPPORTED);
    let startedFlow: OAuthFlowState | undefined;
    const host: AccountFlowHost = {
      providerId,
      setFlow: (flow) => { startedFlow = flow; this.setFlow(flow); },
      openExternal: (url) => this.openExternal(url),
      completeWithCode: (flowId, code) => this.finishLoginInternal(providerId, flowId, code),
      persist: async (bundle) => { await this.persistAccount(providerId, bundle, startedFlow); },
      fail: (flow, message) => { flow.error = message; },
      closeFlowServer: (flow) => this.closeFlowServer(flow),
      forgetFlow: (flowId) => { this.pendingFlows.delete(flowId); },
    };
    try {
      await signIn.flow.start(host);
      return this.status(providerId);
    } catch (error) {
      const active = this.findFlow(providerId);
      // A newer attempt replaced this one; its failure must not mark the new attempt failed.
      if (startedFlow && active && active !== startedFlow) return this.status(providerId);
      return this.failFlow(providerId, signIn.flow, active, error);
    }
  }

  async finishLogin(request: LlmProviderAccountLoginFinishRequest): Promise<LlmProviderAccountStatus> {
    const signIn = accountSignIn(request.providerId);
    if (signIn && !signIn.accountAuth.codeInput) {
      return this.status(request.providerId, 'Complete sign-in through the browser or device authorization.', 'failed');
    }
    return this.finishLoginInternal(request.providerId, request.flowId ?? '', request.code?.trim() ?? '');
  }

  private async finishLoginInternal(
    providerId: LlmProviderId,
    flowId: string,
    code: string,
  ): Promise<LlmProviderAccountStatus> {
    const signIn = accountSignIn(providerId);
    if (!signIn?.flow.exchangeCode) return this.status(providerId, NOT_SUPPORTED);
    const flow = this.findFlow(providerId, flowId || undefined);
    if (!flow) {
      return this.status(providerId, 'Login flow expired or was not started.', 'failed');
    }
    try {
      const bundle = await signIn.flow.exchangeCode(flow, code);
      return await this.persistAccount(providerId, bundle, flow);
    } catch (error) {
      return this.failFlow(providerId, signIn.flow, flow, error);
    }
  }

  async test(providerId: LlmProviderId): Promise<LlmProviderAccountStatus> {
    if (!accountSignIn(providerId)) return this.status(providerId, NOT_SUPPORTED);
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
    if (!accountSignIn(providerId)) return;
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error('Account is not connected.');
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
    if (!accountSignIn(providerId)) {
      throw new Error('Provider does not support account catalog discovery.');
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error('Account is not connected.');
    }
    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    // EffectiveCatalogService owns discovery publication and persistence after
    // checking configuration generation. Discovery must not rewrite settings.
    return this.discoverCatalog(activeBundle);
  }

  async forceRefreshRuntimeCredentials(providerId: LlmProviderId): Promise<void> {
    if (!accountSignIn(providerId)) return;
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
    const accountAuth = getProviderAccountAuth(providerId);
    const flow = accountAuth ? this.findFlow(providerId) : null;
    const authenticated = Boolean(provider?.isConfigured && provider.status === 'verified' && provider.authMode === 'account');
    const connected = authenticated && forcedState !== 'failed' && !flow?.error;
    const accountBundle = accountAuth ? this.readBundle(providerId) : null;
    const available = Boolean(accountAuth) && provider?.authModeAvailability?.account?.state !== 'unavailable';
    const state: LlmProviderAccountStatus['state'] = forcedState
      ?? (flow?.error ? 'failed' : flow ? 'pending' : connected ? 'connected' : accountAuth ? 'signed-out' : 'unavailable');
    const activeDiagnostic = diagnostic ?? flow?.diagnostic;
    return {
      providerId,
      state,
      available,
      connected,
      message: message ?? flow?.error ?? (connected
        ? 'Connected'
        : flow && accountAuth ? pendingAuthorizationMessage(accountAuth) : 'Not connected'),
      error: forcedState === 'failed' ? message : flow?.error,
      accountLabel: provider?.accountLabel,
      planLabel: provider?.planLabel,
      expiresAt: provider?.oauthExpiresAt,
      oauthRefreshAvailable: provider?.oauthRefreshAvailable,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow && accountAuth?.codeInput),
      authorizationMode: flow?.authorizationMode ?? accountBundle?.authorizationMode,
      diagnostic: activeDiagnostic,
      requestedScopes: flow?.requestedScopes ?? activeDiagnostic?.requestedScopes ?? accountBundle?.requestedScopes,
      redirectUri: flow?.redirectUri ?? activeDiagnostic?.redirectUri ?? accountBundle?.redirectUri,
      models: provider?.models ?? [],
    };
  }

  logout(providerId: LlmProviderId): LlmProviderAccountStatus {
    const signIn = accountSignIn(providerId);
    if (signIn) {
      const bundle = signIn.flow.revoke ? this.readBundle(providerId) : null;
      this.clearFlows(providerId);
      if (bundle) {
        void signIn.flow.revoke?.(bundle);
      }
      settingsService.disconnectProvider(providerId, 'account');
    }
    return this.status(providerId);
  }

  private failFlow(
    providerId: LlmProviderId,
    flow: AccountAuthFlow,
    state: OAuthFlowState | null,
    error: unknown,
  ): LlmProviderAccountStatus {
    const diagnostic = flow.diagnose?.(error, state);
    const message = diagnostic ? renderAccountDiagnosticMessage(diagnostic) : parseProviderError(error);
    if (state) {
      state.error = message;
      state.diagnostic = diagnostic;
    }
    return this.status(providerId, message, 'failed', diagnostic);
  }

  /**
   * Saves a signed-in account once its catalog is known. A flow that was cancelled or replaced while
   * credentials were exchanged or the catalog loaded must not overwrite the account.
   */
  private async persistAccount(
    providerId: LlmProviderId,
    bundle: OAuthSecretBundle,
    flow?: OAuthFlowState,
  ): Promise<LlmProviderAccountStatus> {
    const flowIsCurrent = () => !flow || (!flow.abortController?.signal.aborted && this.pendingFlows.get(flow.flowId) === flow);
    if (!flowIsCurrent()) throw new Error('Sign-in was cancelled.');
    const discovery = await this.discoverCatalog(bundle, flow?.abortController?.signal);
    if (!flowIsCurrent()) throw new Error('Sign-in was cancelled.');
    if (discovery.models.length === 0) {
      throw new Error('Account provider returned no usable models.');
    }
    await this.saveAccountDiscovery(providerId, bundle, discovery, true);
    this.clearFlows(providerId);
    return this.status(providerId);
  }

  private async saveAccountDiscovery(
    providerId: LlmProviderId,
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
        oauthRefreshAvailable: this.flowFor(bundle).canRefresh(bundle),
      },
    );
    if (publish && this.catalogPublisher) {
      await this.catalogPublisher(providerId, discovery);
    }
  }

  private async refreshBundleIfNeeded(bundle: OAuthSecretBundle, force = false): Promise<OAuthSecretBundle> {
    const flow = this.flowFor(bundle);
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === bundle.providerId);
    const accountId = provider?.activeAccountId ?? bundle.accountId ?? `anonymous:${bundle.providerId}`;
    const ownsAccount = () => {
      const current = settingsService.getAll().llm.providers.find(entry => entry.id === bundle.providerId);
      return current?.activeAccountId === provider?.activeAccountId
        && JSON.stringify(this.readBundle(bundle.providerId)) === JSON.stringify(bundle);
    };
    return oauthRefreshManager.refresh({
      key: { providerId: bundle.providerId, accountId },
      current: bundle,
      expiresAt: bundle.expiresAt,
      force: force || Boolean(flow.requiresRefresh?.(bundle)),
      refresh: () => flow.refresh?.(bundle) ?? Promise.resolve(bundle),
      commit: (refreshed) => {
        if (!ownsAccount()) throw new Error('PROVIDER_ACCOUNT_CHANGED: credential refresh no longer owns this account.');
        settingsService.rotateProviderAccountCredential(bundle.providerId, JSON.stringify(refreshed), {
          accountLabel: refreshed.accountLabel,
          planLabel: refreshed.planLabel,
          oauthExpiresAt: refreshed.expiresAt,
          oauthRefreshAvailable: flow.canRefresh(refreshed),
        });
      },
      onInvalidGrant: (error) => {
        if (ownsAccount()) settingsService.markProviderAccountRefreshFailure(bundle.providerId, error.message);
      },
    });
  }

  private async discoverCatalog(bundle: OAuthSecretBundle, signal?: AbortSignal): Promise<AccountCatalogDiscovery> {
    await loadProviderSurface(bundle.providerId);
    return this.flowFor(bundle).discover(bundle, signal);
  }

  /** The flow that owns a stored bundle; a bundle only exists for a surface with account sign-in. */
  private flowFor(bundle: OAuthSecretBundle): AccountAuthFlow {
    const signIn = accountSignIn(bundle.providerId);
    if (!signIn) throw new Error(`Provider ${bundle.providerId} has no account sign-in.`);
    return signIn.flow;
  }

  private readBundle(providerId: LlmProviderId): OAuthSecretBundle | null {
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

  private findFlow(providerId: LlmProviderId, flowId?: string): OAuthFlowState | null {
    for (const flow of this.pendingFlows.values()) {
      if (flow.providerId === providerId && (!flowId || flow.flowId === flowId) && (Date.now() <= flow.expiresAt || Boolean(flow.error))) {
        return flow;
      }
    }
    return null;
  }

  private setFlow(flow: OAuthFlowState): void {
    this.clearFlows(flow.providerId);
    this.pendingFlows.set(flow.flowId, flow);
  }

  cancelLogin(providerId: LlmProviderId): void {
    this.clearFlows(providerId);
  }

  dispose(): void {
    for (const flow of this.pendingFlows.values()) this.closeFlowServer(flow);
    this.pendingFlows.clear();
  }

  private clearFlows(providerId: LlmProviderId): void {
    for (const [flowId, flow] of this.pendingFlows.entries()) {
      if (flow.providerId === providerId) {
        this.closeFlowServer(flow);
        this.pendingFlows.delete(flowId);
      }
    }
  }

  private closeFlowServer(flow: OAuthFlowState): void {
    clearTimeout(flow.timeout);
    flow.abortController?.abort();
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
    await openExternalHttps(url);
  }
}

export const providerAccountAuthService = new ProviderAccountAuthService();
