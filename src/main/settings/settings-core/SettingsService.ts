/**
 * SettingsService — the single writer of the user's settings and the owner of their in-memory snapshot.
 *
 * Storage: `config.json` (schema v9, `settingsFileSchema.ts`) holds only user state. `initialize` reads it once into
 * a frozen `SettingsSnapshot { revision, user }`; every later read is in memory. `update` validates, writes (compact,
 * atomic, only when the document changed), bumps the revision and broadcasts `settings:changed { revision, sections }`.
 *
 * Narrow reads: `snapshot()` for user sections, `providerConnections` for composed providers (catalog + user state +
 * secret presence, memoized per settings and secret revision), `agentModelRoutes` for an Agent's model route,
 * `agentDefinitions` for effective Agent profiles, and `rendererSettingsDto()` for the renderer's whole view.
 *
 * External inputs (secrets, Agent manifests and project trust, global instructions) keep their own revisions; edits
 * made outside the app are re-checked by file stamp in `revalidateExternalInputs` (turn preparation, Settings open).
 */
import { mergeUiPreferences } from '@shared/theme/uiPreferences';
import { deepFreeze } from '@shared/utils/deepFreeze';
import { resolveAgentModel } from '@shared/utils/agentModelRoute';
import { appPathService } from '../../runtime/AppPathService';
import { shellResolver } from '../../runtime/ShellResolver';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { providerCatalogService } from '../provider-catalog/ProviderCatalogService';
import { isBuiltinProviderId } from '../../provider-catalog/ProviderCatalogRegistry';
import { resolvePrimaryConnectionSecretFieldId } from '../provider-auth/ProviderConnectionSchema';
import { auditLog } from '../../runtime/AuditLog';
import { runtimePermissionStateService } from '../../agent-runtime/permissions/RuntimePermissionStateService';
import { secretStorageService } from './SecretStorageService';
import { executionProfileService } from './ExecutionProfileService';
import {
  createEmptyAgentRoutes,
  createLocalAccountId,
  getProviderAccountSecretRef,
  getResolvedProviderSecret,
  normalizeManifestRoutes,
  resolveAccountRuntimeCredential,
} from './settingsProviderSanitize';
import { composeProviders, toUserProviderState, type ProviderConnections } from './providerUserState';
import { LEFT_DEFAULTS, RIGHT_DEFAULTS } from './settingsDefaults';
import { SETTINGS_SCHEMA_VERSION, type SettingsFile, type UserProviderState } from './settingsFileSchema';
import {
  sanitizeAgentPermissionSettings,
  sanitizeAgentRuntimeContextSettings,
  sanitizeAgentShellSettings,
  sanitizeCodeInterpreterSettings,
  sanitizeRdcCliInvokerSettings,
  sanitizeSidebar,
  sanitizeTerminal,
  sanitizeWindow,
} from './settingsSanitize';
import { SettingsAgentOps } from './SettingsAgentOps';
import { SettingsProviderOps } from './SettingsProviderOps';
import { SettingsAgentOverrideOps } from './SettingsAgentOverrideOps';
import { sanitizeAgentModelSettings } from './agentModelSettings';
import { tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import { SettingsStore, type SettingsSnapshot } from './settingsStore';
import { deleteSecretsAfterCommit, orphanProviderDiagnostics, stableSerialize } from './settingsServiceHelpers';
import type { LLMProviderConfig } from '@shared/types/llm';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDefinition,
  AgentModelMigrationPreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';
import type {
  AppRuntimePaths,
  AgentShellSettings,
  AppSettings,
  AppSettingsPatch,
  LlmAgentRoute,
  LlmProviderAuthMode,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProviderDefinitionCommitSnapshot,
  SettingsChangedPayload,
  SettingsFileSection,
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
  private readonly agentOverrideOps = new SettingsAgentOverrideOps(this);
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

  /** Everything the renderer's Settings view needs, composed from the snapshot and the external inputs. */
  rendererSettingsDto(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    const { user } = this.snapshot();
    const view = this.connectionView();
    const paths = appPathService.getRuntimePaths();
    const projectRoot = tryCurrentProjectRoot();
    const providers = [...view.list];
    const agentRoutes = normalizeManifestRoutes(
      agentManifestService.routesFromDefinitions(createEmptyAgentRoutes(), [...this.agentDefinitions(projectRoot)]),
    );
    return {
      appearance: user.appearance,
      layout: user.layout,
      profile: user.profile,
      tooling: user.tooling,
      agentRuntime: user.agentRuntime,
      agentModels: user.agentModels,
      llm: { providers, agentRoutes },
      agents: agentManifestService.getSettings(paths, providers, agentRoutes, [], projectRoot),
      resourceCatalog: {
        diagnostics: [
          ...executionProfileService.getDiagnostics(providers),
          ...orphanProviderDiagnostics([...view.orphanProviderIds], paths.settingsPath),
        ],
      },
      paths: { ...paths, ...(runtimePaths ?? {}) },
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
      const value = field.id === resolvePrimaryConnectionSecretFieldId(provider.connectionSchema)
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
    const accountCredential = provider.authMode === 'account'
      ? resolveAccountRuntimeCredential(provider, workspaceRoot)
      : { apiKey: '', baseUrl: undefined, accountId: undefined };
    return {
      id: provider.id,
      protocol: provider.protocol,
      label: provider.label,
      enabled: provider.enabled,
      apiKey: provider.authMode === 'api-key'
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

  update(patch: AppSettingsPatch): SettingsSnapshot {
    const nextPaths = appPathService.initializeRuntime();
    executionProfileService.ensureScaffold();

    const current = this.snapshot().user;
    const secretRefsToDelete = new Set<string>();
    const providers = patch.llm?.providers
      ? this.applyProviderPatch(current.providers, patch.llm.providers, nextPaths.userRdcRoot, secretRefsToDelete)
      : current.providers;
    const extraSections: SettingsFileSection[] = [];
    if (typeof patch.agents?.globalInstructions === 'string') {
      agentManifestService.saveGlobalInstructions(nextPaths, patch.agents.globalInstructions);
      extraSections.push('globalInstructions');
    }

    const next: SettingsFile = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      appearance: mergeUiPreferences(current.appearance, patch.appearance),
      layout: {
        leftSidebar: sanitizeSidebar(
          { ...current.layout.leftSidebar, ...(patch.layout?.leftSidebar ?? {}) },
          LEFT_DEFAULTS,
          current.layout.leftSidebar,
        ),
        rightPanel: sanitizeSidebar(
          { ...current.layout.rightPanel, ...(patch.layout?.rightPanel ?? {}) },
          RIGHT_DEFAULTS,
          current.layout.rightPanel,
        ),
        terminal: sanitizeTerminal(
          { ...current.layout.terminal, ...(patch.layout?.terminal ?? {}) },
          current.layout.terminal,
        ),
        window: sanitizeWindow(
          { ...current.layout.window, ...(patch.layout?.window ?? {}) },
          current.layout.window,
        ),
      },
      profile: {
        nickname: typeof patch.profile?.nickname === 'string' && patch.profile.nickname.trim()
          ? patch.profile.nickname.trim()
          : current.profile.nickname,
        avatarPath: typeof patch.profile?.avatarPath === 'string'
          ? patch.profile.avatarPath
          : current.profile.avatarPath,
      },
      tooling: {
        rdcCli: sanitizeRdcCliInvokerSettings({
          ...current.tooling.rdcCli,
          ...(patch.tooling?.rdcCli ?? {}),
        }, current.tooling.rdcCli, patch.tooling?.rdcCli !== undefined),
        codeInterpreter: sanitizeCodeInterpreterSettings({
          ...current.tooling.codeInterpreter,
          ...(patch.tooling?.codeInterpreter ?? {}),
        }, current.tooling.codeInterpreter),
        shell: this.mergeAgentShellSettings(current.tooling.shell, patch.tooling?.shell),
      },
      agentRuntime: {
        permissions: sanitizeAgentPermissionSettings({
          ...current.agentRuntime.permissions,
          ...(patch.agentRuntime?.permissions ?? {}),
        }, current.agentRuntime.permissions),
        context: sanitizeAgentRuntimeContextSettings({
          ...current.agentRuntime.context,
          ...(patch.agentRuntime?.context ?? {}),
        }, current.agentRuntime.context),
      },
      agentModels: patch.agentModels ? sanitizeAgentModelSettings(patch.agentModels) : current.agentModels,
      providers,
    };

    const previousPermissions = current.agentRuntime.permissions;
    const nextPermissions = next.agentRuntime.permissions;
    // A permission change is recorded before it is written, so an unrecorded change never takes effect.
    if (stableSerialize(previousPermissions) !== stableSerialize(nextPermissions)) {
      auditLog.record({ kind: 'permission-settings', from: previousPermissions, to: nextPermissions });
    }
    this.store.commit(next, extraSections);
    runtimePermissionStateService.commitMode(nextPermissions.mode);
    deleteSecretsAfterCommit(secretRefsToDelete, nextPaths.userRdcRoot);
    return this.snapshot();
  }

  /**
   * `llm.providers` in a patch is the whole provider list: a catalog provider left out returns to what the catalog
   * alone composes. An entry identical to the current composed entry changes nothing and has no side effects; stored
   * providers the catalog no longer has stay untouched.
   */
  private applyProviderPatch(
    currentStates: Record<string, UserProviderState>,
    drafts: readonly LlmProviderEntry[],
    workspaceRoot: string,
    secretRefsToDelete: Set<string>,
  ): Record<string, UserProviderState> {
    const draftsById = new Map<string, LlmProviderEntry>();
    for (const draft of drafts) {
      const id = draft.id.trim();
      if (isBuiltinProviderId(id) && !draftsById.has(id)) draftsById.set(id, { ...draft, id });
    }
    const next = Object.fromEntries(Object.entries(currentStates).filter(([id]) => !isBuiltinProviderId(id)));
    for (const composed of composeProviders(currentStates, workspaceRoot).providers) {
      const draft = draftsById.get(composed.id);
      if (!draft) continue;
      const state = stableSerialize(draft) === stableSerialize(composed)
        ? currentStates[composed.id]
        : toUserProviderState(this.stageDraftCredential(draft, workspaceRoot, secretRefsToDelete), workspaceRoot);
      if (state) next[composed.id] = state;
    }
    return next;
  }

  /** An API key typed into a provider patch goes to the secret store under a fresh account key. */
  private stageDraftCredential(
    provider: LlmProviderEntry,
    workspaceRoot: string,
    secretRefsToDelete: Set<string>,
  ): LlmProviderEntry {
    const authAccountIds = { ...(provider.authAccountIds ?? {}) };
    if (provider.activeAccountId && !authAccountIds[provider.authMode]) {
      authAccountIds[provider.authMode] = provider.activeAccountId;
    }
    const secretRef = getProviderAccountSecretRef(provider.id, authAccountIds['api-key'], 'api-key');
    const apiKey = provider.apiKey?.trim() ?? '';
    if (provider.authMode === 'api-key' && apiKey) {
      if (!authAccountIds['api-key'] || getResolvedProviderSecret(provider.id, secretRef, workspaceRoot) !== apiKey) {
        authAccountIds['api-key'] = createLocalAccountId();
        if (secretRef) secretRefsToDelete.add(secretRef);
      }
      secretStorageService.setSecret(
        getProviderAccountSecretRef(provider.id, authAccountIds['api-key'], 'api-key'),
        apiKey,
        workspaceRoot,
      );
    } else if (provider.authMode === 'api-key' && provider.hasStoredSecretByAuthMode?.['api-key'] !== true && !provider.hasStoredSecret) {
      if (secretRef) secretRefsToDelete.add(secretRef);
      delete authAccountIds['api-key'];
    }
    return { ...provider, activeAccountId: authAccountIds[provider.authMode], authAccountIds, apiKey: '' };
  }

  async getAgentDefinitionCommit(
    query: AgentDefinitionCommitQuery,
  ): Promise<AgentDefinitionCommitSnapshot | null> {
    return this.agentOps.getAgentDefinitionCommit(query);
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    return this.agentOps.saveAgentDefinition(request);
  }

  previewAgentModelMigration(sourcePath: string): AgentModelMigrationPreview {
    return this.agentOverrideOps.previewModelMigration(sourcePath);
  }

  async applyAgentModelMigration(request: AgentOverrideFileRequest): Promise<void> {
    await this.agentOverrideOps.applyModelMigration(request);
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
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): LlmProviderEntry {
    return this.providerOps.saveProviderAccountConnection(providerId, secretPayload, models, accountSummary);
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
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

  private mergeAgentShellSettings(
    current: AgentShellSettings,
    patch: Partial<AgentShellSettings> | undefined,
  ): AgentShellSettings {
    const next = sanitizeAgentShellSettings({ ...current, ...(patch ?? {}) }, current);
    const previous = current.executable;
    if (previous !== next.executable) {
      shellResolver.clearCache();
    }
    return next;
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
