/**
 * SettingsService — the single writer of the user's settings and the owner of their in-memory snapshot.
 *
 * Storage: `config.json` (`settingsFileSchema.ts`) holds only user state. `initialize` reads it once into
 * a frozen `SettingsSnapshot { revision, user }`; every later read is in memory. `update` applies `settings:patch` ops
 * (sections and single Agent model fields; never provider state), sanitizes, writes (compact, atomic, only when the
 * document changed), bumps the revision and broadcasts `settings:changed { revision, sections }`. Provider state
 * changes only through the provider commands, one provider at a time.
 *
 * Narrow reads: `snapshot()` for user sections, `providerConnections` for composed providers (catalog + user state +
 * secret presence, memoized per settings and secret revision), `agentModelRoutes` for an Agent's model route,
 * `agentDefinitions` for effective Agent profiles, and `settingsView()` for the renderer's view (no catalog facts).
 *
 * External inputs (secrets, Agent manifests and project trust, global instructions) keep their own revisions; edits
 * made outside the app are re-checked by file stamp in `revalidateExternalInputs` (turn preparation, Settings open).
 */
import { deepFreeze } from '@shared/utils/deepFreeze';
import { diffAgentModels } from '@shared/utils/settingsPatch';
import { providerConnectionState } from '@shared/utils/providerEntryView';
import { resolveAgentModel } from '@shared/utils/agentModelRoute';
import { appPathService } from '../../runtime/AppPathService';
import { shellResolver } from '../../runtime/ShellResolver';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { providerCatalogService } from '../provider-catalog/ProviderCatalogService';
import { resolvePrimaryConnectionSecretFieldId } from '../provider-auth/ProviderConnectionSchema';
import { auditLog } from '../../runtime/AuditLog';
import { runtimePermissionStateService } from '../../runtime/RuntimePermissionStateService';
import { secretStorageService } from './SecretStorageService';
import { executionProfileService } from './ExecutionProfileService';
import {
  createEmptyAgentRoutes,
  getProviderAccountSecretRef,
  getResolvedProviderSecret,
  normalizeManifestRoutes,
  resolveAccountRuntimeCredential,
} from './settingsProviderSanitize';
import { composeProviders, toUserProviderState, type ProviderConnections } from './providerUserState';
import { sanitizeWindow } from './settingsSanitize';
import { SettingsAgentOps } from './SettingsAgentOps';
import { SettingsProviderOps } from './SettingsProviderOps';
import { SettingsAgentOverrideOps } from './SettingsAgentOverrideOps';
import { planSettingsPatch } from './settingsPatch';
import { tryCurrentProjectId, tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import { SettingsStore, type SettingsSnapshot } from './settingsStore';
import { orphanProviderDiagnostics, stableSerialize } from './settingsServiceHelpers';
import type { SettingsFile, UserProviderState } from './settingsFileSchema';
import type { LLMProviderConfig } from '../provider-auth/ProviderRuntimeCredentialService';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDefinition,
  AgentOverrideFilePreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';
import type {
  SettingsView,
  LlmAgentRoute,
  LlmProviderAuthMode,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProviderDefinitionCommitSnapshot,
  SettingsChangedPayload,
  SettingsFileSection,
  SettingsPatchChanges,
  SettingsPatchOp,
  SettingsPatchResult,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  WindowLayoutPreference,
} from '@shared/types/settings';

export type { SettingsSnapshot } from './settingsStore';

interface ConnectionView {
  states: SettingsFile['providers'];
  secretsRevision: number;
  list: readonly LlmProviderEntry[];
  byId: ReadonlyMap<string, LlmProviderEntry>;
  orphanProviderIds: readonly string[];
}

export class SettingsService {
  private readonly store = new SettingsStore();
  private readonly agentOps = new SettingsAgentOps();
  private readonly agentOverrideOps = new SettingsAgentOverrideOps();
  private readonly providerOps: SettingsProviderOps;
  private connections: ConnectionView | null = null;

  /** Composed providers: catalog facts + the user's provider state + which credentials the secret store holds. */
  readonly providerConnections: ProviderConnections = {
    get: (providerId) => this.connectionView().byId.get(providerId),
    list: () => this.connectionView().list,
  };

  /** The model route Settings → Agents gives an Agent; empty ids when none is configured. */
  readonly agentModelRoutes = {
    resolve: (agentId: string): LlmAgentRoute => {
      const route = resolveAgentModel(agentId, this.snapshot().user.agentModels).route;
      return { agentId, providerId: route?.providerId ?? '', modelId: route?.modelId ?? '' };
    },
  };

  constructor() {
    this.providerOps = new SettingsProviderOps(this);
    agentManifestService.bindAgentModelSettings(() => this.snapshot().user.agentModels);
  }

  /**
   * Reads the settings file once (strictly; nothing is written) and composes the providers, so an unreadable
   * settings or secret file fails startup. A missing file means defaults until the user changes something.
   */
  initialize(): SettingsSnapshot {
    if (this.store.loaded) return this.store.snapshot();
    appPathService.initializeRuntime();
    const snapshot = this.store.load();
    executionProfileService.ensureScaffold();
    this.connectionView();
    runtimePermissionStateService.initialize(snapshot.user.agentRuntime.permissions.mode);
    return snapshot;
  }

  snapshot(): SettingsSnapshot {
    if (!this.store.loaded) this.initialize();
    return this.store.snapshot();
  }

  onChanged(listener: (change: SettingsChangedPayload) => void): () => void {
    return this.store.onChanged(listener);
  }

  /** Re-checks secrets, Agent manifests, trust and global instructions against their files (stamp only). */
  revalidateExternalInputs(): void {
    secretStorageService.revalidate();
    agentManifestService.revalidate();
  }

  /** Recomposed only when the stored provider states (kept by identity across commits) or the secrets change. */
  private connectionView(): ConnectionView {
    const states = this.snapshot().user.providers;
    if (this.connections?.states === states && this.connections.secretsRevision === secretStorageService.revision) {
      return this.connections;
    }
    const { providers, orphanProviderIds } = composeProviders(states, appPathService.getUserRdcRoot());
    const list = deepFreeze(providers);
    this.connections = {
      states,
      // Read after composing: the first secret read may move the secret store to the current resource root.
      secretsRevision: secretStorageService.revision,
      list,
      byId: new Map(list.map((provider) => [provider.id, provider])),
      orphanProviderIds,
    };
    return this.connections;
  }

  /** Effective Agent profiles for a project (the selected one when omitted), as Settings lists them. */
  agentDefinitions(projectRoot = tryCurrentProjectRoot()): readonly AgentManifestDefinition[] {
    return agentManifestService.definitions(appPathService.getRuntimePaths(), projectRoot);
  }

  /** The renderer's settings view: user sections and connection state at the current revision, no catalog facts. */
  settingsView(): SettingsView {
    const { revision, user } = this.snapshot();
    const view = this.connectionView();
    const paths = appPathService.getRuntimePaths();
    const projectId = tryCurrentProjectId();
    const projectRoot = tryCurrentProjectRoot();
    const agentRoutes = normalizeManifestRoutes(
      agentManifestService.routesFromDefinitions(createEmptyAgentRoutes(), [...this.agentDefinitions(projectRoot)]),
    );
    return {
      revision,
      appearance: user.appearance,
      layout: user.layout,
      profile: user.profile,
      tooling: user.tooling,
      agentRuntime: user.agentRuntime,
      agentModels: user.agentModels,
      llm: { connections: view.list.map(providerConnectionState), agentRoutes },
      agents: { ...agentManifestService.getSettings(paths, projectRoot), projectId: projectRoot ? projectId : null },
      resourceCatalog: {
        diagnostics: [
          ...executionProfileService.getDiagnostics([...view.list]),
          ...orphanProviderDiagnostics([...view.orphanProviderIds], paths.settingsPath),
        ],
      },
      paths,
    };
  }

  getProviderSecret(providerId: string): string {
    const provider = this.providerConnections.get(providerId);
    if (!provider || !provider.authModeOptions?.includes('api-key')) {
      return '';
    }
    return getResolvedProviderSecret(provider.id, provider.secretRef, appPathService.getUserRdcRoot());
  }

  hasProviderSecret(providerId: string): { hasSecret: boolean; maskedPreview?: string } {
    const plaintext = this.getProviderSecret(providerId);
    if (!plaintext) {
      return { hasSecret: false };
    }
    const maskedPreview = secretStorageService.maskSecretPreview(plaintext);
    return maskedPreview ? { hasSecret: true, maskedPreview } : { hasSecret: true };
  }

  getProviderConnectionValues(providerId: string): Record<string, string> {
    const provider = this.providerConnections.get(providerId);
    if (!provider) {
      return {};
    }
    const workspaceRoot = appPathService.getUserRdcRoot();
    const values: Record<string, string> = { ...(provider.connectionValues ?? {}) };
    for (const field of provider.connectionSchema?.fields ?? []) {
      if (field.kind !== 'secret') {
        continue;
      }
      const value =
        field.id === resolvePrimaryConnectionSecretFieldId(provider.connectionSchema)
          ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot)
          : secretStorageService.getSecret(provider.secretRefs?.[field.id], workspaceRoot).trim();
      if (value) {
        values[field.id] = value;
      }
    }
    return values;
  }

  getProviderOAuthSecret(providerId: string): string {
    const provider = this.providerConnections.get(providerId);
    return secretStorageService.getSecret(
      getProviderAccountSecretRef(providerId, provider?.authAccountIds?.account, 'oauth'),
      appPathService.getUserRdcRoot(),
    );
  }

  /** The credentials a verified provider runs with; undefined when it is not configured and verified. */
  runtimeProviderConfig(providerId: string): LLMProviderConfig | undefined {
    const provider = this.providerConnections.get(providerId);
    if (!provider?.enabled || !provider.isConfigured || provider.status !== 'verified') return undefined;
    const workspaceRoot = appPathService.getUserRdcRoot();
    const accountCredential =
      provider.authMode === 'account'
        ? resolveAccountRuntimeCredential(provider, workspaceRoot)
        : { apiKey: '', baseUrl: undefined, accountId: undefined };
    return {
      id: provider.id,
      protocol: provider.protocol,
      label: provider.label,
      enabled: provider.enabled,
      apiKey:
        provider.authMode === 'api-key'
          ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot)
          : accountCredential.apiKey,
      baseUrl: accountCredential.baseUrl ?? provider.baseUrl,
      accountId: accountCredential.accountId,
      authMode: provider.authMode,
      docsUrl: provider.docsUrl,
    };
  }

  /** Patch layout.window only; providers are not composed and secrets are not read. */
  persistWindowLayout(window: WindowLayoutPreference): void {
    const { user } = this.snapshot();
    this.store.commit({ ...user, layout: { ...user.layout, window: sanitizeWindow(window, user.layout.window) } });
  }

  /** Commits one provider's user state and returns it composed; other stored providers stay as they were. */
  commitProvider(entry: LlmProviderEntry): LlmProviderEntry {
    const { user } = this.snapshot();
    const state = toUserProviderState(entry, appPathService.getUserRdcRoot());
    this.store.commit({ ...user, providers: withProviderState(user.providers, entry.id, state) });
    const committed = this.providerConnections.get(entry.id);
    if (!committed) throw new Error(`Provider ${entry.id} disappeared after commit.`);
    return committed;
  }

  /**
   * Applies `settings:patch` ops in order and commits once. The result carries the new revision and only what changed:
   * each changed section as stored, and the Agent model bindings that changed.
   */
  update(ops: readonly SettingsPatchOp[]): SettingsPatchResult {
    const before = this.snapshot();
    const current = before.user;
    const { next, globalInstructions } = planSettingsPatch(current, ops);
    const extraSections: SettingsFileSection[] = [];
    if (globalInstructions !== undefined) {
      agentManifestService.saveGlobalInstructions(appPathService.initializeRuntime(), globalInstructions);
      extraSections.push('globalInstructions');
    }

    const previousPermissions = current.agentRuntime.permissions;
    const nextPermissions = next.agentRuntime.permissions;
    // A permission change is recorded before it is written, so an unrecorded change never takes effect.
    if (stableSerialize(previousPermissions) !== stableSerialize(nextPermissions)) {
      auditLog.record({ kind: 'permission-settings', from: previousPermissions, to: nextPermissions });
    }
    const change = this.store.commit(next, extraSections);
    if (!change) return { revision: before.revision, changed: {} };
    if (current.tooling.shell.executable !== next.tooling.shell.executable) shellResolver.clearCache();
    runtimePermissionStateService.commitMode(nextPermissions.mode);

    const changed: SettingsPatchChanges = {};
    for (const section of change.sections) {
      if (section === 'appearance') changed.appearance = next.appearance;
      else if (section === 'layout') changed.layout = next.layout;
      else if (section === 'profile') changed.profile = next.profile;
      else if (section === 'tooling') changed.tooling = next.tooling;
      else if (section === 'agentRuntime') changed.agentRuntime = next.agentRuntime;
      else if (section === 'globalInstructions') changed.globalInstructions = true;
      else if (section === 'agentModels') {
        const bindings = diffAgentModels(current.agentModels, next.agentModels);
        if (bindings) changed.agentModels = bindings;
      }
    }
    return { revision: change.revision, changed };
  }

  async getAgentDefinitionCommit(query: AgentDefinitionCommitQuery): Promise<AgentDefinitionCommitSnapshot | null> {
    return this.agentOps.getAgentDefinitionCommit(query);
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    return this.agentOps.saveAgentDefinition(request);
  }

  previewAgentOverrideFile(sourcePath: string): AgentOverrideFilePreview {
    return this.agentOverrideOps.previewOverrideFile(sourcePath);
  }

  async deleteAgentOverrideFile(request: AgentOverrideFileRequest): Promise<void> {
    await this.agentOverrideOps.deleteOverrideFile(request);
  }

  previewProjectAgentTrust(sourcePath: string): ProjectAgentTrustPreview {
    return this.agentOverrideOps.previewProjectAgentTrust(sourcePath);
  }

  trustProjectAgent(request: AgentOverrideFileRequest): void {
    this.agentOverrideOps.trustProjectAgent(request);
  }

  getAgentBuiltinComparison(query: AgentDefinitionCommitQuery): AgentBuiltinComparison {
    return this.agentOverrideOps.getBuiltinComparison(query);
  }

  async getProviderDefinitionCommit(providerIdDraft: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    return this.providerOps.getProviderDefinitionCommit(providerIdDraft);
  }

  setProviderDefinitionCatalogRevision(providerId: string, catalogRevision: string | null): void {
    this.providerOps.setProviderDefinitionCatalogRevision(providerId, catalogRevision);
  }

  async saveProviderDefinition(request: ProviderDefinitionSaveRequest): Promise<ProviderDefinitionSaveResult> {
    return this.providerOps.saveProviderDefinition(request);
  }

  saveProviderConnection(
    providerId: LlmProviderId,
    apiKey: string,
    models: LlmProviderModel[],
    baseUrl?: string,
    protocolDraft?: unknown,
    authModeDraft?: LlmProviderAuthMode,
    modelPreferences?: LlmProviderModelPreference[],
    connectionValuesDraft?: Record<string, string>,
  ): LlmProviderEntry {
    return this.providerOps.saveProviderConnection(
      providerId,
      apiKey,
      models,
      baseUrl,
      protocolDraft,
      authModeDraft,
      modelPreferences,
      connectionValuesDraft,
    );
  }

  saveProviderAccountConnection(
    providerId: LlmProviderId,
    secretPayload: string,
    models: LlmProviderModel[],
    accountSummary: Pick<
      LlmProviderEntry,
      'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'
    > = {},
  ): LlmProviderEntry {
    return this.providerOps.saveProviderAccountConnection(providerId, secretPayload, models, accountSummary);
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<
      LlmProviderEntry,
      'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'
    > = {},
  ): LlmProviderEntry {
    return this.providerOps.rotateProviderAccountCredential(providerId, secretPayload, accountSummary);
  }

  markProviderAccountRefreshFailure(providerId: LlmProviderId, message: string): void {
    this.providerOps.markProviderAccountRefreshFailure(providerId, message);
  }

  disconnectProvider(providerId: LlmProviderId, authModeDraft?: LlmProviderAuthMode): LlmProviderEntry {
    return this.providerOps.disconnectProvider(providerId, authModeDraft);
  }

  getProviderCatalog() {
    return providerCatalogService.getProviderCatalog();
  }

  hasConfiguredProvider(): boolean {
    return this.providerConnections.list().some((provider) => provider.isConfigured);
  }
}

function withProviderState(
  providers: Record<string, UserProviderState>,
  providerId: string,
  state: UserProviderState | undefined,
): Record<string, UserProviderState> {
  const { [providerId]: _previous, ...others } = providers;
  return state ? { ...others, [providerId]: state } : others;
}

export const settingsService = new SettingsService();
