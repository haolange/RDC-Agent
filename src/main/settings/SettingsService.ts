import fs from 'fs';
import path from 'path';
import Store from 'electron-store';
import type {
  AppLanguage,
  AppRuntimePaths,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  ConfigurationSettings,
  FontScale,
  LayoutPreferences,
  LlmAgentRoute,
  LlmProviderConnectionStatus,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  ProfileSettings,
  SidebarLayoutPreference,
  UiPreferences,
  WorkspaceSettings,
} from '@shared/types/settings';
import type { LLMConfig, LLMProviderConfig } from '@shared/types/llm';
import { DEFAULT_MODEL_ROUTING } from '@shared/types/agent';
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
} from '@shared/constants/layout';
import {
  createBuiltinProviderEntry,
  createBuiltinProviderEntries,
  getBuiltinProviderDefinition,
  isBuiltinProviderId,
} from '@shared/constants/llm';
import { appPathService } from '../runtime/AppPathService';
import { executionProfileService } from './ExecutionProfileService';
import { secretStorageService } from './SecretStorageService';

interface LegacyOpenRouterSettings {
  apiKey: string;
  baseUrl?: string;
}

interface LegacyAppGlobalSettings {
  openRouter?: LegacyOpenRouterSettings;
}

interface PersistedConfigurationSettings {
  activeModeProfileId?: string;
  lastMigrationReportPath?: string;
}

interface PersistedSettingsPayload {
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
  workspace?: Partial<WorkspaceSettings>;
  llm?: {
    providers?: LlmProviderEntry[];
    agentRoutes?: LlmAgentRoute[];
  };
  configuration?: PersistedConfigurationSettings;
}

interface HardRebuildResult {
  settings: PersistedSettingsPayload;
  changed: boolean;
  fixes: string[];
  warnings: string[];
}

interface NormalizedPersistedSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  workspace: WorkspaceSettings;
  llm: {
    providers: LlmProviderEntry[];
    agentRoutes: LlmAgentRoute[];
  };
  configuration: PersistedConfigurationSettings;
}

const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: LEFT_SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH,
};

const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: RIGHT_PANEL_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH,
};

const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];
const VALID_LANGUAGES: AppLanguage[] = ['zh-CN', 'en'];
const VALID_FONT_SCALES: FontScale[] = ['small', 'medium', 'large'];
const KNOWN_AGENT_IDS = new Set(Object.keys(DEFAULT_MODEL_ROUTING));
const EMPTY_PATHS: AppRuntimePaths = {
  workspaceRoot: '',
  defaultWorkspaceRoot: '',
  settingsPath: '',
  logsPath: '',
  logPath: '',
  projectsPath: '',
  knowledgePath: '',
  migrationOrphansPath: '',
  profilesPath: '',
  policiesPath: '',
  secretsPath: '',
  migrationReportsPath: '',
};

const DEFAULT_APPEARANCE: UiPreferences = {
  theme: 'dark',
  language: 'zh-CN',
  fontScale: 'medium',
};

const DEFAULT_LAYOUT: LayoutPreferences = {
  leftSidebar: {
    collapsed: false,
    width: LEFT_DEFAULTS.width,
    expandedWidth: LEFT_DEFAULTS.width,
  },
  rightPanel: {
    collapsed: false,
    width: RIGHT_DEFAULTS.width,
    expandedWidth: RIGHT_DEFAULTS.width,
  },
  terminal: {
    height: TERMINAL_DEFAULT_HEIGHT,
  },
};

const DEFAULT_PROFILE: ProfileSettings = {
  nickname: 'RDC Operator',
  avatarPath: '',
};

const DEFAULT_CONFIGURATION: PersistedConfigurationSettings = {
  activeModeProfileId: 'debugger.default',
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    console.warn('[SettingsService] Failed to read JSON:', filePath, error);
    return null;
  }
}

function isVendorSecretUsable(providerId: string, secret: string): boolean {
  const normalized = secret.trim();
  if (!normalized) {
    return false;
  }

  if (providerId === 'openrouter') {
    return /^sk-or-/i.test(normalized);
  }

  if (providerId === 'openai') {
    return /^sk-/i.test(normalized);
  }

  if (providerId === 'anthropic') {
    return /^sk-ant-/i.test(normalized);
  }

  return true;
}

function getResolvedProviderSecret(providerId: string, secretRef: string | undefined, workspaceRoot: string): string {
  const secret = secretStorageService.getSecret(secretRef, workspaceRoot).trim();
  return isVendorSecretUsable(providerId, secret) ? secret : '';
}

function resolveAccountRuntimeCredential(providerId: string, workspaceRoot: string): { apiKey: string; baseUrl?: string; accountId?: string } {
  const raw = secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
  if (!raw) {
    return { apiKey: '' };
  }
  try {
    const bundle = JSON.parse(raw) as {
      accessToken?: string;
      apiKey?: string;
      copilotToken?: string;
      copilotApiBaseUrl?: string;
      accountId?: string;
    };
    if (providerId === 'github-copilot') {
      return {
        apiKey: bundle.copilotToken ?? '',
        baseUrl: bundle.copilotApiBaseUrl ?? 'https://api.githubcopilot.com',
      };
    }
    if (providerId === 'chatgpt-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        accountId: bundle.accountId,
      };
    }
    return {
      apiKey: bundle.accessToken ?? '',
      baseUrl: 'https://api.anthropic.com/v1',
    };
  } catch {
    return { apiKey: '' };
  }
}

function sanitizeSidebar(
  input: unknown,
  defaults: typeof LEFT_DEFAULTS | typeof RIGHT_DEFAULTS,
  fallback: SidebarLayoutPreference,
): SidebarLayoutPreference {
  const candidate = (input ?? {}) as Partial<SidebarLayoutPreference>;
  const expandedWidth = clamp(
    typeof candidate.expandedWidth === 'number' ? candidate.expandedWidth : fallback.expandedWidth,
    defaults.min,
    defaults.max,
  );

  return {
    collapsed: typeof candidate.collapsed === 'boolean' ? candidate.collapsed : fallback.collapsed,
    expandedWidth,
    width: clamp(
      typeof candidate.width === 'number'
        ? candidate.width
        : fallback.collapsed
          ? defaults.collapsedWidth
          : expandedWidth,
      defaults.collapsedWidth,
      defaults.max,
    ),
  };
}

function sanitizeTerminal(input: unknown, fallback = DEFAULT_LAYOUT.terminal): LayoutPreferences['terminal'] {
  const candidate = (input ?? {}) as Partial<LayoutPreferences['terminal']>;
  return {
    height: clamp(
      typeof candidate.height === 'number' ? candidate.height : fallback.height,
      TERMINAL_MIN_HEIGHT,
      TERMINAL_MAX_HEIGHT,
    ),
  };
}

function sanitizeModels(models: unknown): LlmProviderModel[] {
  const candidates = Array.isArray(models) ? models : [];
  const modelMap = new Map<string, LlmProviderModel>();

  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Partial<LlmProviderModel>;
    const modelId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!modelId || modelMap.has(modelId)) {
      continue;
    }

    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
      contextWindowTokens: typeof candidate.contextWindowTokens === 'number' && Number.isFinite(candidate.contextWindowTokens)
        ? Math.max(0, Math.round(candidate.contextWindowTokens))
        : null,
    });
  }

  return Array.from(modelMap.values());
}

function createEmptyAgentRoutes(): LlmAgentRoute[] {
  return Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));
}

function createDefaultPersistedSettings(workspaceRoot = appPathService.getWorkspaceRoot()): PersistedSettingsPayload {
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot,
    },
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes(),
    },
    configuration: DEFAULT_CONFIGURATION,
  };
}

function createDefaultRuntimeSettings(workspaceRoot = appPathService.getWorkspaceRoot()): AppSettings {
  const configuration = executionProfileService.normalizeConfiguration({
    activeModeProfileId: DEFAULT_CONFIGURATION.activeModeProfileId || 'debugger.default',
    availableModeProfiles: [],
    lastMigrationReportPath: undefined,
    lastMigrationSummary: [],
    diagnostics: [],
  }, workspaceRoot);

  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot,
    },
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes(),
    },
    configuration,
    paths: EMPTY_PATHS,
  };
}

function sanitizeRoute(entry: unknown): LlmAgentRoute | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const route = entry as Partial<LlmAgentRoute>;
  if (typeof route.agentId !== 'string' || !KNOWN_AGENT_IDS.has(route.agentId)) {
    return null;
  }

  return {
    agentId: route.agentId as LlmAgentRoute['agentId'],
    providerId: typeof route.providerId === 'string' ? route.providerId.trim() : '',
    modelId: typeof route.modelId === 'string' ? route.modelId.trim() : '',
  };
}

function pickProviderStatus(
  provider: Partial<LlmProviderEntry>,
  fallback: LlmProviderEntry,
  canUseProvider: boolean,
  models: LlmProviderModel[],
): LlmProviderConnectionStatus {
  if (fallback.status === 'unavailable') {
    return 'unavailable';
  }
  if (provider.status === 'failed') {
    return 'failed';
  }
  if ((provider.status === 'verified' || provider.isConfigured === true) && canUseProvider && models.length > 0) {
    return 'verified';
  }
  return 'unconfigured';
}

function isFixtureProvider(provider: Partial<LlmProviderEntry>): boolean {
  const id = typeof provider.id === 'string' ? provider.id.trim() : '';
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim().toLowerCase() : '';

  return (
    /^provider-\d+$/i.test(id)
    || id === 'acme'
    || id === 'vendorx'
    || baseUrl.includes('example.com')
    || baseUrl.includes('acme.local')
    || baseUrl.includes('vendorx.ai')
  );
}

function normalizeLegacyProviderId(providerId: string): string {
  if (providerId === 'gemini') return 'vertex';
    if (providerId === 'kimi' || providerId === 'kimi-coding-plan') return 'kimi-code';
  if (providerId === 'minimax') return 'minimax-global';
  if (providerId === 'zai') return 'glm-global';
  return providerId;
}

function sanitizeUserProvider(
  provider: Partial<LlmProviderEntry>,
  workspaceRoot = appPathService.getWorkspaceRoot(),
): LlmProviderEntry | null {
  const rawId = normalizeLegacyProviderId(typeof provider.id === 'string' ? provider.id.trim() : '');
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }

  const builtinFallback = createBuiltinProviderEntry(rawId);
  const definition = getBuiltinProviderDefinition(rawId);
  const useBuiltinProviderMetadata = rawId === 'kimi-code';
  const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(rawId);
  const kind = builtinFallback.kind;
  const models = sanitizeModels(provider.models ?? []);
  const oauthSecretRef = secretStorageService.createProviderOAuthSecretRef(rawId);
  const resolvedSecret = builtinFallback.authMode === 'api-key'
    ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot)
    : builtinFallback.authMode === 'account'
      ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot)
      : '';
  const hasStoredSecret = builtinFallback.authMode === 'local' || builtinFallback.authMode === 'environment' || Boolean(resolvedSecret);
  const canUseProvider = builtinFallback.authMode === 'local' || builtinFallback.authMode === 'environment'
    ? true
    : builtinFallback.authMode === 'api-key'
      ? Boolean(resolvedSecret)
      : Boolean(resolvedSecret);
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const enabled = status === 'verified' && models.length > 0;
  const label = useBuiltinProviderMetadata
    ? builtinFallback.label
    : typeof provider.label === 'string' && provider.label.trim()
      ? provider.label.trim()
      : builtinFallback.label;
  const recommendedModels = useBuiltinProviderMetadata
    ? builtinFallback.recommendedModels
    : dedupeStrings(
      Array.isArray(provider.recommendedModels)
        ? provider.recommendedModels.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
        : builtinFallback.recommendedModels,
    );
  const docsUrl = useBuiltinProviderMetadata
    ? builtinFallback.docsUrl
    : typeof provider.docsUrl === 'string' && provider.docsUrl.trim()
      ? provider.docsUrl.trim()
      : builtinFallback.docsUrl;

  return {
    id: rawId,
    kind,
    authMode: builtinFallback.authMode,
    catalogGroup: builtinFallback.catalogGroup,
    modelDiscovery: builtinFallback.modelDiscovery,
    label,
    enabled,
    apiKey: '',
    secretRef,
    hasStoredSecret,
    baseUrl: definition?.baseUrlEditable
      ? (typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : definition.baseUrl)
      : definition?.baseUrl,
    baseUrlEditable: definition?.baseUrlEditable,
    models,
    recommendedModels,
    docsUrl,
    status,
    lastTestedAt: typeof provider.lastTestedAt === 'string' ? provider.lastTestedAt : undefined,
    lastModelRefreshAt: typeof provider.lastModelRefreshAt === 'string' ? provider.lastModelRefreshAt : undefined,
    lastError: status === 'failed' && typeof provider.lastError === 'string' ? provider.lastError : undefined,
    accountLoginConfigured: definition?.accountLoginConfigured,
    accountLabel: typeof provider.accountLabel === 'string' ? provider.accountLabel : undefined,
    planLabel: typeof provider.planLabel === 'string' ? provider.planLabel : undefined,
    oauthExpiresAt: typeof provider.oauthExpiresAt === 'string' ? provider.oauthExpiresAt : undefined,
    oauthRefreshAvailable: typeof provider.oauthRefreshAvailable === 'boolean' ? provider.oauthRefreshAvailable : undefined,
    unavailableReason: definition?.unavailableReason,
    isConfigured: status === 'verified' && models.length > 0 && enabled,
  };
}

function normalizeUserProviders(
  providers: unknown,
  workspaceRoot: string,
): LlmProviderEntry[] {
  const persistedProviders = new Map<string, LlmProviderEntry>();

  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const provider = sanitizeUserProvider(entry as Partial<LlmProviderEntry>, workspaceRoot);
    if (!provider || persistedProviders.has(provider.id)) {
      continue;
    }

    persistedProviders.set(provider.id, provider);
  }

  return createBuiltinProviderEntries()
    .map((catalogProvider) => sanitizeUserProvider(persistedProviders.get(catalogProvider.id) ?? catalogProvider, workspaceRoot))
    .filter((provider): provider is LlmProviderEntry => provider !== null);
}

function hydrateProviderSecrets(
  providers: LlmProviderEntry[],
  workspaceRoot: string,
): LlmProviderEntry[] {
  return providers.map((provider) => {
    const resolvedSecret = provider.authMode === 'api-key'
      ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot)
      : provider.authMode === 'account'
        ? secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), workspaceRoot)
        : '';
    const hasStoredSecret = provider.authMode === 'local' || provider.authMode === 'environment' || Boolean(resolvedSecret);
    const canUseProvider = provider.authMode === 'local' || provider.authMode === 'environment'
      ? true
      : provider.authMode === 'api-key'
        ? Boolean(resolvedSecret)
        : Boolean(resolvedSecret);
    const status = provider.status === 'unavailable'
      ? 'unavailable'
      : provider.status === 'verified' && canUseProvider && provider.models.length > 0
        ? 'verified'
        : provider.status === 'failed'
          ? 'failed'
          : 'unconfigured';
    const isConfigured = status === 'verified' && provider.models.length > 0;

    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: '',
      hasStoredSecret,
      enabled: isConfigured,
      status,
      isConfigured,
    };
  });
}

function normalizeUserRoutes(
  routes: unknown,
  providers: LlmProviderEntry[],
): LlmAgentRoute[] {
  const routeMap = new Map<string, LlmAgentRoute>();
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }

  return createEmptyAgentRoutes().map((route) => {
    const incoming = routeMap.get(route.agentId);
    if (!incoming?.providerId || !incoming.modelId) {
      return route;
    }

    const provider = providers.find((entry) => entry.id === incoming.providerId);
    const isValid = Boolean(
      provider
      && provider.isConfigured
      && provider.models.some((model) => model.id === incoming.modelId && model.enabled !== false),
    );

    return isValid ? incoming : route;
  });
}

function parseMigrationSummary(reportPath?: string): string[] {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return [];
  }

  try {
    const content = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
      fixes?: string[];
      warnings?: string[];
    };
    return [...(content.fixes ?? []), ...(content.warnings ?? [])];
  } catch (error) {
    console.warn('[SettingsService] Failed to read migration report:', error);
    return [];
  }
}

export class SettingsService {
  private legacyStore: Store<LegacyAppGlobalSettings>;
  private initialized = false;

  constructor() {
    this.legacyStore = new Store<LegacyAppGlobalSettings>({
      name: 'rdc-agent-settings',
    });
  }

  initialize(): AppSettings {
    const runtimePaths = appPathService.initializeWorkspaceRoot();
    executionProfileService.ensureScaffold(runtimePaths.workspaceRoot);

    const rawPersisted = readJsonFile<PersistedSettingsPayload>(runtimePaths.settingsPath);
    const rebuildResult = this.rebuildPersistedSettings(rawPersisted, runtimePaths.workspaceRoot, true);
    if (rebuildResult.changed || !fs.existsSync(runtimePaths.settingsPath)) {
      this.persistHardRebuild(runtimePaths, rawPersisted, rebuildResult);
    }

    this.initialized = true;
    return this.getAll(runtimePaths);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private rebuildPersistedSettings(
    raw: PersistedSettingsPayload | null,
    workspaceRoot: string,
    includeLegacySecrets: boolean,
  ): HardRebuildResult {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const fixes: string[] = [];
    const warnings: string[] = [];
    const rawProviders = Array.isArray(candidate.llm?.providers) ? candidate.llm?.providers : [];
    const rawRoutes = Array.isArray(candidate.llm?.agentRoutes) ? candidate.llm?.agentRoutes : [];

    const nextProviders: LlmProviderEntry[] = [];
    for (const entry of rawProviders) {
      if (isFixtureProvider(entry)) {
        fixes.push(`Removed fixture provider ${entry.id}`);
        secretStorageService.deleteSecret(entry.secretRef, workspaceRoot);
        continue;
      }

      const rawId = normalizeLegacyProviderId(typeof entry.id === 'string' ? entry.id.trim() : '');
      if (!rawId) {
        fixes.push('Removed provider with empty id');
        continue;
      }

      const secretRef = entry.secretRef || secretStorageService.createProviderSecretRef(rawId);
      if (entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }

      const sanitized = sanitizeUserProvider({ ...entry, secretRef }, workspaceRoot);
      if (!sanitized) {
        fixes.push(`Removed non-catalog provider ${rawId}`);
        continue;
      }

      if (!nextProviders.some((provider) => provider.id === sanitized.id)) {
        nextProviders.push(sanitized);
      } else {
        fixes.push(`Removed duplicated provider ${sanitized.id}`);
      }
    }

    if (includeLegacySecrets) {
      const legacyOpenRouter = this.legacyStore.get('openRouter');
      if (legacyOpenRouter?.apiKey?.trim()) {
        const secretRef = secretStorageService.createProviderSecretRef('openrouter');
        secretStorageService.setSecret(secretRef, legacyOpenRouter.apiKey.trim(), workspaceRoot);
        const sanitized = sanitizeUserProvider({
          ...createBuiltinProviderEntry('openrouter'),
          enabled: true,
          secretRef,
          baseUrl: legacyOpenRouter.baseUrl || createBuiltinProviderEntry('openrouter').baseUrl,
        }, workspaceRoot);

        if (sanitized?.isConfigured && !nextProviders.some((provider) => provider.id === 'openrouter')) {
          nextProviders.push(sanitized);
          fixes.push('Imported legacy OpenRouter provider');
        }
      }
    }

    const catalogProviders = normalizeUserProviders(nextProviders, workspaceRoot);
    const nextRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map(sanitizeRoute).filter((route): route is LlmAgentRoute => route !== null) : [];
    for (const route of incomingRoutes) {
      const normalized = nextRoutes.find((entry) => entry.agentId === route.agentId);
      if (!normalized || normalized.providerId !== route.providerId || normalized.modelId !== route.modelId) {
        if (route.providerId || route.modelId) {
          fixes.push(`Cleared invalid route for ${route.agentId}`);
        }
      }
    }

    if (!catalogProviders.some((provider) => provider.isConfigured)) {
      warnings.push('No configured provider available for Debugger mode.');
    }

    const nextSettings: PersistedSettingsPayload = {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? 'dark'),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? 'zh-CN'),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? 'medium'),
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal),
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === 'string' && candidate.profile.nickname.trim()
          ? candidate.profile.nickname.trim()
          : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === 'string' ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath,
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot,
      },
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: '' })),
        agentRoutes: nextRoutes,
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath,
      },
    };

    return {
      settings: nextSettings,
      changed: JSON.stringify(candidate) !== JSON.stringify(nextSettings),
      fixes,
      warnings,
    };
  }

  private normalizePersistedSettings(
    raw: PersistedSettingsPayload | null,
    workspaceRoot: string,
  ): NormalizedPersistedSettings {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const nextProviders = normalizeUserProviders(candidate.llm?.providers, workspaceRoot).map((provider) => ({
      ...provider,
      apiKey: '',
    }));
    const nextRoutes = normalizeUserRoutes(candidate.llm?.agentRoutes, nextProviders);

    return {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? 'dark'),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? 'zh-CN'),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? 'medium'),
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal),
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === 'string' && candidate.profile.nickname.trim()
          ? candidate.profile.nickname.trim()
          : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === 'string' ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath,
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot,
      },
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes,
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath,
      },
    };
  }

  private writeMigrationReport(paths: AppRuntimePaths, fixes: string[], warnings: string[]): string {
    const reportPath = path.join(paths.migrationReportsPath, `settings-rebuild-${Date.now()}.json`);
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: nowIso(),
      fixes,
      warnings,
    }, null, 2), 'utf8');
    return reportPath;
  }

  private persistHardRebuild(
    paths: AppRuntimePaths,
    previous: PersistedSettingsPayload | null,
    result: HardRebuildResult,
  ): void {
    const nextSettings: PersistedSettingsPayload = {
      ...result.settings,
      configuration: {
        ...result.settings.configuration,
      },
    };

    if (result.changed && previous && fs.existsSync(paths.settingsPath)) {
      fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
      const backupPath = path.join(paths.migrationOrphansPath, `settings.backup.${Date.now()}.json`);
      fs.copyFileSync(paths.settingsPath, backupPath);
    }

    if (result.changed && (result.fixes.length > 0 || result.warnings.length > 0)) {
      nextSettings.configuration = {
        ...nextSettings.configuration,
        lastMigrationReportPath: this.writeMigrationReport(paths, result.fixes, result.warnings),
      };
    }

    this.writeSettings(nextSettings, paths.workspaceRoot);
  }

  private toRuntimeSettings(
    persisted: PersistedSettingsPayload,
    runtimePaths?: Partial<AppRuntimePaths>,
  ): AppSettings {
    const workspaceRoot = persisted.workspace?.rootPath?.trim() || appPathService.getWorkspaceRoot();
    const normalized = this.normalizePersistedSettings(persisted, workspaceRoot);
    const hydratedProviders = hydrateProviderSecrets(normalized.llm.providers, workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const configuration: ConfigurationSettings = executionProfileService.normalizeConfiguration({
      activeModeProfileId: normalized.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId || 'debugger.default',
      availableModeProfiles: [],
      lastMigrationReportPath: normalized.configuration?.lastMigrationReportPath,
      lastMigrationSummary: parseMigrationSummary(normalized.configuration?.lastMigrationReportPath),
      diagnostics: [],
    }, workspaceRoot);

    const settings: AppSettings = {
      ...createDefaultRuntimeSettings(workspaceRoot),
      appearance: normalized.appearance,
      layout: normalized.layout,
      profile: normalized.profile,
      workspace: {
        rootPath: workspaceRoot,
      },
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders),
      },
      configuration,
      paths: {
        ...paths,
        ...(runtimePaths ?? {}),
      },
    };

    settings.configuration.diagnostics = executionProfileService.getDiagnostics(settings);
    return settings;
  }

  private writeSettings(settings: PersistedSettingsPayload, workspaceRoot = settings.workspace?.rootPath || appPathService.getWorkspaceRoot()): void {
    const filePath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  }

  getAll(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const paths = appPathService.getWorkspacePaths();
    const persisted = readJsonFile<PersistedSettingsPayload>(paths.settingsPath)
      ?? createDefaultPersistedSettings(paths.workspaceRoot);
    return this.toRuntimeSettings(persisted, runtimePaths);
  }

  getProviderSecret(providerId: string, workspaceRoot = appPathService.getWorkspaceRoot()): string {
    this.ensureInitialized();

    const persisted = this.normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(appPathService.getWorkspacePaths(workspaceRoot).settingsPath)
        ?? createDefaultPersistedSettings(workspaceRoot),
      workspaceRoot,
    );
    const provider = persisted.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || provider.authMode !== 'api-key') {
      return '';
    }

    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }

  getProviderOAuthSecret(providerId: string, workspaceRoot = appPathService.getWorkspaceRoot()): string {
    this.ensureInitialized();
    return secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();

    const currentRuntime = this.getAll();
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentRuntime.workspace.rootPath || appPathService.getWorkspacePaths().workspaceRoot;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    executionProfileService.ensureScaffold(nextPaths.workspaceRoot);

    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(nextPaths.settingsPath) ?? createDefaultPersistedSettings(nextPaths.workspaceRoot),
      nextPaths.workspaceRoot,
    );

    const providerDrafts = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(provider.id);
      const apiKey = provider.apiKey?.trim() ?? '';
      if (provider.authMode === 'api-key' && apiKey) {
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.workspaceRoot);
      } else if (provider.authMode === 'api-key' && !provider.hasStoredSecret) {
        secretStorageService.deleteSecret(secretRef, nextPaths.workspaceRoot);
      }
      return sanitizeUserProvider({
        ...provider,
        secretRef,
      }, nextPaths.workspaceRoot);
    }).filter((provider): provider is LlmProviderEntry => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.workspaceRoot);

    const nextPersisted: PersistedSettingsPayload = {
      appearance: {
        theme: pickEnum(
          patch.appearance?.theme ?? currentPersisted.appearance?.theme,
          VALID_THEMES,
          DEFAULT_APPEARANCE.theme,
        ),
        language: pickEnum(
          patch.appearance?.language ?? currentPersisted.appearance?.language,
          VALID_LANGUAGES,
          DEFAULT_APPEARANCE.language,
        ),
        fontScale: pickEnum(
          patch.appearance?.fontScale ?? currentPersisted.appearance?.fontScale,
          VALID_FONT_SCALES,
          DEFAULT_APPEARANCE.fontScale,
        ),
      },
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
      },
      profile: {
        nickname: typeof patch.profile?.nickname === 'string' && patch.profile.nickname.trim()
          ? patch.profile.nickname.trim()
          : currentPersisted.profile?.nickname || DEFAULT_PROFILE.nickname,
        avatarPath: typeof patch.profile?.avatarPath === 'string'
          ? patch.profile.avatarPath
          : currentPersisted.profile?.avatarPath || DEFAULT_PROFILE.avatarPath,
      },
      workspace: {
        rootPath: nextPaths.workspaceRoot,
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: '' })),
        agentRoutes: normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? [], nextProviders),
      },
      configuration: {
        activeModeProfileId: patch.configuration?.activeModeProfileId
          || currentPersisted.configuration?.activeModeProfileId
          || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: currentPersisted.configuration?.lastMigrationReportPath,
      },
    };

    this.writeSettings(nextPersisted, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
  }

  saveProviderConnection(providerId: LlmProviderId, apiKey: string, models: LlmProviderModel[], baseUrl = ''): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error('该 Provider 暂未返回可用模型');
    }

    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      apiKey: apiKey.trim(),
      enabled: true,
      hasStoredSecret: provider.authMode === 'api-key'
        ? Boolean(apiKey.trim() || provider.hasStoredSecret)
        : provider.authMode === 'local' || provider.authMode === 'environment' || provider.hasStoredSecret,
      baseUrl: provider.baseUrlEditable ? baseUrl.trim() || provider.baseUrl : provider.baseUrl,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      isConfigured: true,
    };

    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
  }

  saveProviderAccountConnection(
    providerId: LlmProviderId,
    secretPayload: string,
    models: LlmProviderModel[],
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || provider.authMode !== 'account') {
      throw new Error(`Unknown account provider: ${providerId}`);
    }

    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error('Provider returned no usable models');
    }

    secretStorageService.setSecret(
      secretStorageService.createProviderOAuthSecretRef(provider.id),
      secretPayload,
      current.workspace.rootPath,
    );

    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      enabled: true,
      hasStoredSecret: true,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      isConfigured: true,
    };

    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
  }

  disconnectProvider(providerId: LlmProviderId): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (provider.authMode === 'api-key') {
      secretStorageService.deleteSecret(provider.secretRef, current.workspace.rootPath);
    } else if (provider.authMode === 'account') {
      secretStorageService.deleteSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), current.workspace.rootPath);
    }

    const fallback = createBuiltinProviderEntry(provider.id);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      apiKey: '',
      hasStoredSecret: fallback.hasStoredSecret,
      models: [],
      enabled: false,
      status: fallback.status,
      lastError: undefined,
      accountLabel: undefined,
      planLabel: undefined,
      oauthExpiresAt: undefined,
      oauthRefreshAvailable: undefined,
      isConfigured: false,
    };

    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
  }

  getLlmConfig(): LLMConfig {
    const settings = this.getAll();
    const providers: LLMProviderConfig[] = settings.llm.providers
      .filter((provider) => provider.enabled && provider.isConfigured && provider.status === 'verified')
      .map((provider) => {
        const accountCredential = provider.authMode === 'account'
          ? resolveAccountRuntimeCredential(provider.id, settings.workspace.rootPath)
          : { apiKey: '', baseUrl: undefined };
        return {
          id: provider.id,
          kind: provider.kind,
          label: provider.label,
          enabled: provider.enabled,
          apiKey: provider.authMode === 'api-key'
            ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.workspace.rootPath)
            : provider.authMode === 'account'
              ? accountCredential.apiKey
              : '',
          baseUrl: accountCredential.baseUrl ?? provider.baseUrl,
          accountId: accountCredential.accountId,
          authMode: provider.authMode,
          models: provider.models.filter((model) => model.enabled).map((model) => model.id),
          docsUrl: provider.docsUrl,
        };
      })
      .filter((provider) => provider.models.length > 0);

    return {
      providers,
      agentRoutes: settings.llm.agentRoutes,
    };
  }

  hasConfiguredProvider(): boolean {
    return this.getAll().llm.providers.some((provider) => provider.isConfigured);
  }

  getSettingsPath(): string {
    return appPathService.getWorkspacePaths().settingsPath;
  }
}

export const settingsService = new SettingsService();
