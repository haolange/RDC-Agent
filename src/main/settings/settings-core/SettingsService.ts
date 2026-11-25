/**
 * SettingsService — reads and writes the user's settings file and composes the runtime settings view.
 *
 * Storage: `config.json` (schema v9, `settingsFileSchema.ts`) holds only user state. It is read strictly on every
 * access; a missing file means defaults and nothing is written until the user changes something. Writes are compact,
 * atomic, and happen only when the document actually changes.
 *
 * Providers: each runtime `LlmProviderEntry` is composed once from the catalog, the stored user state and the secret
 * store (`providerUserState.ts`).
 *
 * Agent models: `agentModels` (default + per Agent) is the only source of Agent routes;
 * `agentManifestService.routeForAgent` resolves them. Scoped agent-definition saves keep
 * `clientRevision <= latestRevision` conflict detection and never change a route.
 */
import { mergeUiPreferences } from '@shared/theme/uiPreferences';
import { compiledRoutesFromDefinitions } from '../provider-catalog/compiledAgentRoutes';
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
  createLocalAccountId,
  getProviderAccountSecretRef,
  getResolvedProviderSecret,
  resolveAccountRuntimeCredential,
} from './settingsProviderSanitize';
import { composeProviderEntry, composeProviders, toUserProviderState } from './providerUserState';
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
import {
  deleteSecretsAfterCommit,
  readSettingsFile,
  readSettingsFileOrDefaults,
  stableSerialize,
  toRuntimeSettings,
  writeSettingsFile,
} from './settingsServiceHelpers';
import type { LLMConfig, LLMProviderConfig } from '@shared/types/llm';
import type {
  AgentBuiltinComparison,
  AgentDefinitionCommitQuery,
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentModelMigrationPreview,
  AgentOverrideFileRequest,
  ProjectAgentTrustPreview,
} from '@shared/types/agentManifest';
import type {
  AppRuntimePaths,
  AgentShellSettings,
  AppSettings,
  AppSettingsPatch,
  LlmProviderAuthMode,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  WindowLayoutPreference,
} from '@shared/types/settings';

export class SettingsService {
  private initialized = false;
  private readonly agentOps = new SettingsAgentOps();
  private readonly agentOverrideOps = new SettingsAgentOverrideOps(this);
  private readonly providerOps: SettingsProviderOps;

  constructor() {
    this.providerOps = new SettingsProviderOps(this);
    // Agent routes are resolved from the committed settings file, the same source getAll() reads.
    agentManifestService.bindAgentModelSettings(() => readSettingsFileOrDefaults().agentModels);
  }

  /**
   * Reads the settings file strictly and writes nothing: a missing file means defaults until the user changes
   * something; an unusable file throws `SettingsFileError`, which main turns into the startup failure.
   */
  initialize(): AppSettings {
    appPathService.initializeRuntime();
    readSettingsFile();
    executionProfileService.ensureScaffold();
    this.initialized = true;
    const settings = this.getAll();
    runtimePermissionStateService.initialize(settings.agentRuntime.permissions.mode);
    return settings;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  getAll(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    return toRuntimeSettings(readSettingsFileOrDefaults(), runtimePaths);
  }

  /** One provider composed from the committed file, without composing the whole catalog. */
  private composeStoredProvider(providerId: string, workspaceRoot: string): LlmProviderEntry | null {
    this.ensureInitialized();
    if (!isBuiltinProviderId(providerId)) return null;
    return composeProviderEntry(providerId, readSettingsFileOrDefaults().providers[providerId], workspaceRoot);
  }

  getProviderSecret(providerId: string, workspaceRoot = appPathService.getUserRdcRoot()): string {
    const provider = this.composeStoredProvider(providerId, workspaceRoot);
    if (!provider || !provider.authModeOptions?.includes('api-key')) {
      return '';
    }

    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }

  hasProviderSecret(
    providerId: string,
    workspaceRoot = appPathService.getUserRdcRoot(),
  ): { hasSecret: boolean; maskedPreview?: string } {
    const plaintext = this.getProviderSecret(providerId, workspaceRoot);
    if (!plaintext) {
      return { hasSecret: false };
    }
    const maskedPreview = secretStorageService.maskSecretPreview(plaintext);
    return maskedPreview ? { hasSecret: true, maskedPreview } : { hasSecret: true };
  }

  getProviderConnectionValues(
    providerId: string,
    workspaceRoot = appPathService.getUserRdcRoot(),
  ): Record<string, string> {
    const provider = this.composeStoredProvider(providerId, workspaceRoot);
    if (!provider) {
      return {};
    }

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

  getProviderOAuthSecret(providerId: string, workspaceRoot = appPathService.getUserRdcRoot()): string {
    const provider = this.composeStoredProvider(providerId, workspaceRoot);
    return secretStorageService.getSecret(
      getProviderAccountSecretRef(providerId, provider?.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
  }

  /** Patch layout.window only; providers are not composed and secrets are not read. */
  persistWindowLayout(window: WindowLayoutPreference): void {
    this.ensureInitialized();
    const current = readSettingsFileOrDefaults();
    this.writeIfChanged(current, {
      ...current,
      layout: { ...current.layout, window: sanitizeWindow(window, current.layout.window) },
    });
  }

  /** "Only on real user changes": a patch that leaves the document as it was writes nothing. */
  private writeIfChanged(current: SettingsFile, next: SettingsFile): void {
    if (stableSerialize(next) !== stableSerialize(current)) writeSettingsFile(next);
  }

  /** Commits one provider's user state; every other stored provider stays byte-for-byte as it was. */
  commitProvider(entry: LlmProviderEntry): AppSettings {
    this.ensureInitialized();
    const paths = appPathService.initializeRuntime();
    const current = readSettingsFileOrDefaults();
    this.writeIfChanged(current, {
      ...current,
      providers: withProviderState(current.providers, entry.id, toUserProviderState(entry, paths.userRdcRoot)),
    });
    return this.getAll();
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();

    const nextPaths = appPathService.initializeRuntime();
    executionProfileService.ensureScaffold();

    const current = readSettingsFileOrDefaults();
    const secretRefsToDelete = new Set<string>();
    const providers = patch.llm?.providers
      ? this.applyProviderPatch(current.providers, patch.llm.providers, nextPaths.userRdcRoot, secretRefsToDelete)
      : current.providers;
    if (typeof patch.agents?.globalInstructions === 'string') {
      agentManifestService.saveGlobalInstructions(nextPaths, patch.agents.globalInstructions);
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
    this.writeIfChanged(current, next);
    runtimePermissionStateService.commitMode(nextPermissions.mode);
    deleteSecretsAfterCommit(secretRefsToDelete, nextPaths.userRdcRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
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
    this.ensureInitialized();
    return this.agentOps.getAgentDefinitionCommit(query);
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    this.ensureInitialized();
    return this.agentOps.saveAgentDefinition(request);
  }

  previewAgentModelMigration(sourcePath: string): AgentModelMigrationPreview {
    this.ensureInitialized();
    return this.agentOverrideOps.previewModelMigration(sourcePath);
  }

  async applyAgentModelMigration(request: AgentOverrideFileRequest): Promise<AppSettings> {
    this.ensureInitialized();
    return this.agentOverrideOps.applyModelMigration(request);
  }

  async deleteAgentOverrideFile(request: AgentOverrideFileRequest): Promise<AppSettings> {
    this.ensureInitialized();
    return this.agentOverrideOps.deleteOverrideFile(request);
  }

  previewProjectAgentTrust(sourcePath: string): ProjectAgentTrustPreview {
    this.ensureInitialized();
    return this.agentOverrideOps.previewProjectAgentTrust(sourcePath);
  }

  trustProjectAgent(request: AgentOverrideFileRequest): AppSettings {
    this.ensureInitialized();
    return this.agentOverrideOps.trustProjectAgent(request);
  }

  getAgentBuiltinComparison(query: AgentDefinitionCommitQuery): AgentBuiltinComparison {
    this.ensureInitialized();
    return this.agentOverrideOps.getBuiltinComparison(query);
  }

  async getProviderDefinitionCommit(providerIdDraft: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    this.ensureInitialized();
    return this.providerOps.getProviderDefinitionCommit(providerIdDraft);
  }

  setProviderDefinitionCatalogRevision(providerId: string, catalogRevision: string | null): void {
    this.providerOps.setProviderDefinitionCatalogRevision(providerId, catalogRevision);
  }

  async saveProviderDefinition(request: ProviderDefinitionSaveRequest): Promise<ProviderDefinitionSaveResult> {
    this.ensureInitialized();
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
  ): AppSettings {
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
  ): AppSettings {
    return this.providerOps.saveProviderAccountConnection(providerId, secretPayload, models, accountSummary);
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
    return this.providerOps.rotateProviderAccountCredential(providerId, secretPayload, accountSummary);
  }

  markProviderAccountRefreshFailure(providerId: LlmProviderId, message: string): AppSettings {
    return this.providerOps.markProviderAccountRefreshFailure(providerId, message);
  }

  disconnectProvider(providerId: LlmProviderId, authModeDraft?: LlmProviderAuthMode): AppSettings {
    return this.providerOps.disconnectProvider(providerId, authModeDraft);
  }

  getLlmConfig(): LLMConfig {
    const settings = this.getAll();
    const providers: LLMProviderConfig[] = settings.llm.providers
      .filter((provider) => provider.enabled && provider.isConfigured && provider.status === 'verified')
      .map((provider) => {
        const accountCredential = provider.authMode === 'account'
          ? resolveAccountRuntimeCredential(provider, settings.paths.userRdcRoot)
          : { apiKey: '', baseUrl: undefined };
        return {
          id: provider.id,
          protocol: provider.protocol,
          label: provider.label,
          enabled: provider.enabled,
          apiKey: provider.authMode === 'api-key'
            ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.paths.userRdcRoot)
            : provider.authMode === 'account'
              ? accountCredential.apiKey
              : '',
          baseUrl: accountCredential.baseUrl ?? provider.baseUrl,
          accountId: accountCredential.accountId,
          authMode: provider.authMode,
          docsUrl: provider.docsUrl,
        };
      });

    return {
      providers,
      agentRoutes: compiledRoutesFromDefinitions(settings.agents.definitions),
    };
  }

  getProviderCatalog() {
    return providerCatalogService.getProviderCatalog();
  }

  hasConfiguredProvider(): boolean {
    return this.getAll().llm.providers.some((provider) => provider.isConfigured);
  }

  getSettingsPath(): string {
    return appPathService.getRuntimePaths().settingsPath;
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
