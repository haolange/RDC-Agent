/**
 * SettingsService — persists and normalizes application settings.
 *
 * Provider normalization: `capabilities: definition?.capabilities` hydrates builtin
 * provider capabilities from the catalog definition.
 *
 * Agent runtime: `agentRuntime` persists agent runtime permission controls.
 *
 * Agent models: `agentModels` (default + per Agent) is the only source of Agent routes;
 * `agentManifestService.routeForAgent` resolves them. Scoped agent-definition saves keep
 * `clientRevision <= latestRevision` conflict detection and never change a route.
 */
import { mergeUiPreferences, sanitizeUiPreferences } from '@shared/theme/uiPreferences';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  DEFAULT_PROFILE,
  DEFAULT_CODE_INTERPRETER,
  DEFAULT_RDC_CLI_INVOKER,
  DEFAULT_SHELL_TOOLING,
} from '@shared/constants/appSettingsDefaults';
import { compiledRoutesFromDefinitions } from '../provider-catalog/compiledAgentRoutes';
import { appPathService } from '../../runtime/AppPathService';
import { shellResolver } from '../../runtime/ShellResolver';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { providerCatalogService } from '../provider-catalog/ProviderCatalogService';
import { resolvePrimaryConnectionSecretFieldId } from '../provider-auth/ProviderConnectionSchema';
import { auditLog } from '../../runtime/AuditLog';
import { runtimePermissionStateService } from '../../agent-runtime/permissions/RuntimePermissionStateService';
import { secretStorageService } from './SecretStorageService';
import { executionProfileService } from './ExecutionProfileService';
import {
  createLocalAccountId,
  getProviderAccountSecretRef,
  getResolvedProviderSecret,
  normalizeUserProviders,
  resolveAccountRuntimeCredential,
  sanitizeUserProvider,
  type ProviderCredentialView,
} from './settingsProviderSanitize';
import {
  LEFT_DEFAULTS,
  RIGHT_DEFAULTS,
  SETTINGS_SCHEMA_VERSION,
  createDefaultPersistedSettings,
  type PersistedSettingsPayload,
} from './settingsDefaults';
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
  assertPersistedSettingsSchemaVersion,
  createDefaultRuntimeSettings,
  deleteSecretsAfterCommit,
  normalizePersistedSettings,
  readJsonFile,
  rebuildPersistedSettings,
  toRuntimeSettings,
  writeSettings,
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

export { SETTINGS_SCHEMA_VERSION } from './settingsDefaults';

export class SettingsService {
  private initialized = false;
  private readonly agentOps = new SettingsAgentOps();
  private readonly agentOverrideOps = new SettingsAgentOverrideOps(this);
  private readonly providerOps: SettingsProviderOps;

  constructor() {
    this.providerOps = new SettingsProviderOps(this);
    // Agent routes are resolved from the committed settings file, the same source getAll() reads.
    agentManifestService.bindAgentModelSettings(() => {
      const persisted = readJsonFile<PersistedSettingsPayload>(appPathService.getRuntimePaths().settingsPath);
      return sanitizeAgentModelSettings(persisted?.agentModels);
    });
  }

  initialize(): AppSettings {
    const runtimePaths = appPathService.initializeRuntime();
    const rawPersisted = readJsonFile<PersistedSettingsPayload>(runtimePaths.settingsPath);
    assertPersistedSettingsSchemaVersion(rawPersisted, runtimePaths.settingsPath);
    executionProfileService.ensureScaffold();
    const rebuildResult = rebuildPersistedSettings(rawPersisted, runtimePaths.userRdcRoot);
    this.persistHardRebuild(runtimePaths, rawPersisted, rebuildResult);

    this.initialized = true;
    const settings = this.getAll(runtimePaths);
    runtimePermissionStateService.initialize(settings.agentRuntime.permissions.mode);
    return settings;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private persistHardRebuild(
    paths: AppRuntimePaths,
    _previous: PersistedSettingsPayload | null,
    result: ReturnType<typeof rebuildPersistedSettings>,
  ): void {
    writeSettings(result.settings);
    shellResolver.clearCache();
    deleteSecretsAfterCommit(result.secretRefsToDelete, paths.userRdcRoot);
  }

  getAll(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const paths = appPathService.getRuntimePaths();
    const persisted = readJsonFile<PersistedSettingsPayload>(paths.settingsPath)
      ?? createDefaultPersistedSettings();
    assertPersistedSettingsSchemaVersion(persisted, paths.settingsPath);
    return toRuntimeSettings(persisted, runtimePaths);
  }

  getProviderSecret(providerId: string, workspaceRoot = appPathService.getUserRdcRoot()): string {
    this.ensureInitialized();

    const persisted = normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(appPathService.getRuntimePaths().settingsPath)
        ?? createDefaultPersistedSettings(),
      workspaceRoot,
    );
    const provider = persisted.llm.providers.find((entry) => entry.id === providerId);
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
    this.ensureInitialized();
    const persisted = normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(appPathService.getRuntimePaths().settingsPath)
        ?? createDefaultPersistedSettings(),
      workspaceRoot,
    );
    const provider = persisted.llm.providers.find((entry) => entry.id === providerId);
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
    this.ensureInitialized();
    const provider = this.getAll().llm.providers.find((entry) => entry.id === providerId);
    return secretStorageService.getSecret(
      getProviderAccountSecretRef(providerId, provider?.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
  }

  /**
   * Patch layout.window in the same synchronous transaction used by other settings.
   * Skips provider normalization and secret hydration.
   */
  persistWindowLayout(window: WindowLayoutPreference): void {
    this.ensureInitialized();
    const paths = appPathService.getRuntimePaths();
    const current = readJsonFile<PersistedSettingsPayload>(paths.settingsPath);
    writeSettings(this.assembleWindowLayoutPayload(window, current));
  }

  private assembleWindowLayoutPayload(
    window: WindowLayoutPreference,
    current: PersistedSettingsPayload | null,
  ): PersistedSettingsPayload {
    const base = current ?? createDefaultPersistedSettings();
    const currentLayout = base.layout ?? {};
    return {
      ...base,
      schemaVersion: base.schemaVersion ?? SETTINGS_SCHEMA_VERSION,
      layout: {
        ...currentLayout,
        leftSidebar: currentLayout.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar,
        rightPanel: currentLayout.rightPanel ?? DEFAULT_LAYOUT.rightPanel,
        terminal: currentLayout.terminal ?? DEFAULT_LAYOUT.terminal,
        window: sanitizeWindow(window, currentLayout.window ?? DEFAULT_LAYOUT.window),
      },
    };
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();

    const nextPaths = appPathService.initializeRuntime();
    executionProfileService.ensureScaffold();

    const currentPersisted = normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(nextPaths.settingsPath) ?? createDefaultPersistedSettings(),
      nextPaths.userRdcRoot,
      { credentialView: 'storage-metadata' },
    );

    const hasProviderPatch = Boolean(patch.llm?.providers);
    const providerCredentialView: ProviderCredentialView = hasProviderPatch ? 'runtime' : 'storage-metadata';
    const secretRefsToDelete = new Set<string>();
    const providerDrafts = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      const authAccountIds = { ...(provider.authAccountIds ?? {}) };
      if (provider.activeAccountId && !authAccountIds[provider.authMode]) {
        authAccountIds[provider.authMode] = provider.activeAccountId;
      }
      let secretRef = provider.secretRef
        || getProviderAccountSecretRef(provider.id, authAccountIds['api-key'], 'api-key');
      const apiKey = provider.apiKey?.trim() ?? '';
      if (provider.authMode === 'api-key' && apiKey) {
        const previousSecret = getResolvedProviderSecret(provider.id, secretRef, nextPaths.userRdcRoot);
        if (!authAccountIds['api-key'] || previousSecret !== apiKey) {
          const previousRef = secretRef;
          authAccountIds['api-key'] = createLocalAccountId();
          secretRef = getProviderAccountSecretRef(provider.id, authAccountIds['api-key'], 'api-key');
          if (previousRef && previousRef !== secretRef) {
            secretRefsToDelete.add(previousRef);
          }
        }
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.userRdcRoot);
      } else if (provider.authMode === 'api-key' && provider.hasStoredSecretByAuthMode?.['api-key'] !== true && !provider.hasStoredSecret) {
        if (secretRef) secretRefsToDelete.add(secretRef);
        delete authAccountIds['api-key'];
      }
      return sanitizeUserProvider({
        ...provider,
        activeAccountId: authAccountIds[provider.authMode],
        authAccountIds,
        secretRef,
      }, nextPaths.userRdcRoot, { credentialView: providerCredentialView });
    }).filter((provider): provider is LlmProviderEntry => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.userRdcRoot, {
      credentialView: providerCredentialView,
    });
    if (typeof patch.agents?.globalInstructions === 'string') {
      agentManifestService.saveGlobalInstructions(nextPaths, patch.agents.globalInstructions);
    }

    const nextPersisted: PersistedSettingsPayload = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      appearance: mergeUiPreferences(
        sanitizeUiPreferences(currentPersisted.appearance, DEFAULT_APPEARANCE),
        patch.appearance,
      ),
      layout: {
        leftSidebar: sanitizeSidebar(
          {
            ...(currentPersisted.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
            ...(patch.layout?.leftSidebar ?? {}),
          },
          LEFT_DEFAULTS,
          DEFAULT_LAYOUT.leftSidebar,
        ),
        rightPanel: sanitizeSidebar(
          {
            ...(currentPersisted.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
            ...(patch.layout?.rightPanel ?? {}),
          },
          RIGHT_DEFAULTS,
          DEFAULT_LAYOUT.rightPanel,
        ),
        terminal: sanitizeTerminal(
          {
            ...(currentPersisted.layout?.terminal ?? DEFAULT_LAYOUT.terminal),
            ...(patch.layout?.terminal ?? {}),
          },
          DEFAULT_LAYOUT.terminal,
        ),
        window: sanitizeWindow(
          {
            ...(currentPersisted.layout?.window ?? DEFAULT_LAYOUT.window),
            ...(patch.layout?.window ?? {}),
          },
          DEFAULT_LAYOUT.window,
        ),
      },
      profile: {
        nickname: typeof patch.profile?.nickname === 'string' && patch.profile.nickname.trim()
          ? patch.profile.nickname.trim()
          : currentPersisted.profile?.nickname || DEFAULT_PROFILE.nickname,
        avatarPath: typeof patch.profile?.avatarPath === 'string'
          ? patch.profile.avatarPath
          : currentPersisted.profile?.avatarPath || DEFAULT_PROFILE.avatarPath,
      },
      tooling: {
        rdcCli: sanitizeRdcCliInvokerSettings({
          ...(currentPersisted.tooling?.rdcCli ?? DEFAULT_RDC_CLI_INVOKER),
          ...(patch.tooling?.rdcCli ?? {}),
        }, DEFAULT_RDC_CLI_INVOKER, patch.tooling?.rdcCli !== undefined),
        codeInterpreter: sanitizeCodeInterpreterSettings({
          ...(currentPersisted.tooling?.codeInterpreter ?? DEFAULT_CODE_INTERPRETER),
          ...(patch.tooling?.codeInterpreter ?? {}),
        }),
        shell: this.mergeAgentShellSettings(currentPersisted.tooling?.shell, patch.tooling?.shell),
      },
      agentRuntime: {
        permissions: sanitizeAgentPermissionSettings({
          ...(currentPersisted.agentRuntime?.permissions ?? createDefaultRuntimeSettings().agentRuntime.permissions),
          ...(patch.agentRuntime?.permissions ?? {}),
        }),
        context: sanitizeAgentRuntimeContextSettings({
          ...(currentPersisted.agentRuntime?.context ?? createDefaultRuntimeSettings().agentRuntime.context),
          ...(patch.agentRuntime?.context ?? {}),
        }),
      },
      agentModels: sanitizeAgentModelSettings(patch.agentModels ?? currentPersisted.agentModels),
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: '' })),
      },
    };

    writeSettings(nextPersisted);
    const previousPermissions = sanitizeAgentPermissionSettings(currentPersisted.agentRuntime?.permissions);
    const nextPermissions = sanitizeAgentPermissionSettings(nextPersisted.agentRuntime?.permissions);
    if (JSON.stringify(previousPermissions) !== JSON.stringify(nextPermissions)) {
      auditLog.record({ kind: 'permission-settings', from: previousPermissions, to: nextPermissions });
    }
    runtimePermissionStateService.commitMode(nextPermissions.mode);
    deleteSecretsAfterCommit(secretRefsToDelete, nextPaths.userRdcRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
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
    current: AgentShellSettings | undefined,
    patch: Partial<AgentShellSettings> | undefined,
  ): AgentShellSettings {
    const next = sanitizeAgentShellSettings({
      ...(current ?? DEFAULT_SHELL_TOOLING),
      ...(patch ?? {}),
    });
    const previous = current?.executable ?? DEFAULT_SHELL_TOOLING.executable;
    if (previous !== next.executable) {
      shellResolver.clearCache();
    }
    return next;
  }
}

export const settingsService = new SettingsService();
