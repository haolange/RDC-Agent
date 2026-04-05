import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import Store from 'electron-store';
import type {
  AppLanguage,
  AppRuntimePaths,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  FontScale,
  LayoutPreferences,
  LlmAgentRoute,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderKind,
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
} from '@shared/constants/layout';
import { BUILTIN_LLM_PROVIDER_DEFINITIONS, createBuiltinProviderEntries } from '@shared/constants/llm';
import { appPathService } from './AppPathService';

interface LegacyOpenRouterSettings {
  apiKey: string;
  baseUrl?: string;
}

interface LegacyLlmCredentialEntry {
  id?: string;
  provider?: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

interface LegacySettingsPayload {
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
  workspace?: Partial<WorkspaceSettings>;
  llm?: {
    defaultProvider?: string;
    credentials?: LegacyLlmCredentialEntry[];
    providers?: LlmProviderEntry[];
    agentRoutes?: LlmAgentRoute[];
  };
  paths?: Partial<AppRuntimePaths>;
}

interface LegacyAppGlobalSettings {
  openRouter?: LegacyOpenRouterSettings;
}

interface SanitizeSettingsOptions {
  seedBuiltins: boolean;
  importLegacy: boolean;
  seedDefaultRoutes: boolean;
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

const EMPTY_PATHS: AppRuntimePaths = {
  workspaceRoot: '',
  defaultWorkspaceRoot: '',
  settingsPath: '',
  logsPath: '',
  logPath: '',
  projectsPath: '',
  knowledgePath: '',
  migrationOrphansPath: '',
};

const EMPTY_LEGACY_STORE: LegacyAppGlobalSettings = {};

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
};

const DEFAULT_PROFILE: ProfileSettings = {
  nickname: 'RDC Operator',
  avatarPath: '',
};

const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];
const VALID_LANGUAGES: AppLanguage[] = ['zh-CN', 'en'];
const VALID_FONT_SCALES: FontScale[] = ['small', 'medium', 'large'];
const VALID_PROVIDER_KINDS: LlmProviderKind[] = ['openrouter', 'openai-compatible', 'anthropic', 'ollama'];
const KNOWN_AGENT_IDS = new Set(Object.keys(DEFAULT_MODEL_ROUTING));

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const pickEnum = <T extends string>(value: unknown, allowed: T[], fallback: T): T => {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
};

const dedupeStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const sanitizeSidebar = (
  input: unknown,
  defaults: typeof LEFT_DEFAULTS | typeof RIGHT_DEFAULTS,
  fallback: SidebarLayoutPreference,
): SidebarLayoutPreference => {
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
};

const createEmptyAgentRoutes = (): LlmAgentRoute[] =>
  Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));

const createDefaultSettings = (workspaceRoot = appPathService.getWorkspaceRoot()): AppSettings => ({
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
  paths: EMPTY_PATHS,
});

const toModelId = (value: string): string => value.trim();

const sanitizeModels = (models: unknown): LlmProviderModel[] => {
  const candidates = Array.isArray(models) ? models : [];
  const modelMap = new Map<string, LlmProviderModel>();

  for (const entry of candidates) {
    if (typeof entry === 'string') {
      const modelId = toModelId(entry);
      if (!modelId || modelMap.has(modelId)) {
        continue;
      }
      modelMap.set(modelId, { id: modelId, label: modelId, enabled: true });
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const candidate = entry as Partial<LlmProviderModel>;
    const modelId = typeof candidate.id === 'string' ? toModelId(candidate.id) : '';
    if (!modelId || modelMap.has(modelId)) {
      continue;
    }

    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
    });
  }

  return Array.from(modelMap.values());
};

const getBuiltinDefinition = (providerId: string) =>
  BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === providerId);

const getProviderConfigState = (provider: Pick<LlmProviderEntry, 'enabled' | 'kind' | 'apiKey'>): boolean => {
  if (!provider.enabled) return false;
  if (provider.kind === 'ollama') return true;
  return Boolean(provider.apiKey.trim());
};

const sanitizeProvider = (entry: Partial<LlmProviderEntry>, fallback?: Partial<LlmProviderEntry>): LlmProviderEntry => {
  const fallbackId = typeof fallback?.id === 'string' ? fallback.id : '';
  const entryId = typeof entry.id === 'string' ? entry.id.trim() : '';
  const builtin = getBuiltinDefinition(entryId || fallbackId);
  const providerId = entryId || fallbackId || builtin?.id || 'custom-provider';
  const models = sanitizeModels(entry.models ?? fallback?.models ?? []);
  const resolved: LlmProviderEntry = {
    id: providerId,
    kind: pickEnum<LlmProviderKind>(
      entry.kind,
      VALID_PROVIDER_KINDS,
      fallback?.kind ?? builtin?.kind ?? 'openai-compatible',
    ),
    label: typeof entry.label === 'string'
      ? entry.label.trim()
      : fallback?.label ?? builtin?.label ?? '',
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : fallback?.enabled ?? builtin?.enabled ?? false,
    apiKey: typeof entry.apiKey === 'string' ? entry.apiKey.trim() : fallback?.apiKey ?? '',
    baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl.trim()
      ? entry.baseUrl.trim()
      : fallback?.baseUrl ?? builtin?.baseUrl,
    models,
    recommendedModels: dedupeStrings(
      Array.isArray(entry.recommendedModels)
        ? entry.recommendedModels.filter((value): value is string => typeof value === 'string')
        : fallback?.recommendedModels ?? builtin?.recommendedModels ?? [],
    ),
    docsUrl: typeof entry.docsUrl === 'string' && entry.docsUrl.trim()
      ? entry.docsUrl.trim()
      : fallback?.docsUrl ?? builtin?.docsUrl,
    isConfigured: false,
  };

  resolved.isConfigured = getProviderConfigState(resolved);
  return resolved;
};

const importLegacyCredentials = (
  settings: LegacySettingsPayload,
  providerMap: Map<string, LlmProviderEntry>,
): LlmProviderEntry[] => {
  const credentials = Array.isArray(settings.llm?.credentials) ? settings.llm.credentials : [];
  const imported = new Map<string, LegacyLlmCredentialEntry>();

  for (const credential of credentials) {
    const providerId = typeof credential.provider === 'string' ? credential.provider.trim() : '';
    if (!providerId || !credential.apiKey?.trim()) {
      continue;
    }

    const current = imported.get(providerId);
    if (!current || credential.isDefault) {
      imported.set(providerId, credential);
    }
  }

  return Array.from(imported.entries()).map(([providerId, credential]) => {
    const fallback = providerMap.get(providerId) || createBuiltinProviderEntries().find((entry) => entry.id === providerId);
    return sanitizeProvider({
      id: providerId as LlmProviderId,
      label: credential.label || fallback?.label || providerId,
      enabled: true,
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      models: fallback?.models ?? [],
      recommendedModels: fallback?.recommendedModels ?? [],
      docsUrl: fallback?.docsUrl,
      kind: fallback?.kind ?? 'openai-compatible',
    }, fallback);
  });
};

const mergeProviders = (
  rawProviders: unknown,
  legacySettings: LegacySettingsPayload,
  legacyStore: LegacyAppGlobalSettings,
  options: SanitizeSettingsOptions,
): LlmProviderEntry[] => {
  const providerMap = new Map<string, LlmProviderEntry>();

  if (options.seedBuiltins) {
    for (const provider of createBuiltinProviderEntries()) {
      providerMap.set(provider.id, provider);
    }
  }

  if (Array.isArray(rawProviders)) {
    for (const rawProvider of rawProviders) {
      if (!rawProvider || typeof rawProvider !== 'object') {
        continue;
      }

      const entry = rawProvider as Partial<LlmProviderEntry>;
      const providerId = typeof entry.id === 'string' ? entry.id.trim() : '';
      const fallback = providerId ? providerMap.get(providerId) : undefined;
      const provider = sanitizeProvider(entry, fallback);
      providerMap.set(provider.id, provider);
    }
  }

  if (options.importLegacy) {
    for (const provider of importLegacyCredentials(legacySettings, providerMap)) {
      const fallback = providerMap.get(provider.id);
      providerMap.set(provider.id, sanitizeProvider(provider, fallback));
    }

    if (legacyStore.openRouter?.apiKey) {
      const fallback = providerMap.get('openrouter');
      providerMap.set('openrouter', sanitizeProvider({
        id: 'openrouter',
        enabled: true,
        apiKey: legacyStore.openRouter.apiKey,
        baseUrl: legacyStore.openRouter.baseUrl,
        models: fallback?.models ?? [],
        recommendedModels: fallback?.recommendedModels ?? [],
        docsUrl: fallback?.docsUrl,
        kind: 'openrouter',
        label: fallback?.label ?? 'OpenRouter',
      }, fallback));
    }
  }

  return Array.from(providerMap.values());
};

const sanitizeRoute = (entry: unknown): LlmAgentRoute | null => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = entry as Partial<LlmAgentRoute>;
  if (typeof candidate.agentId !== 'string' || !KNOWN_AGENT_IDS.has(candidate.agentId)) {
    return null;
  }

  return {
    agentId: candidate.agentId as LlmAgentRoute['agentId'],
    providerId: typeof candidate.providerId === 'string' ? candidate.providerId.trim() : '',
    modelId: typeof candidate.modelId === 'string' ? candidate.modelId.trim() : '',
  };
};

const sanitizeAgentRoutes = (
  rawRoutes: unknown,
  options: SanitizeSettingsOptions,
): LlmAgentRoute[] => {
  if (options.seedDefaultRoutes) {
    const routeMap = new Map<string, LlmAgentRoute>();
    const providedRoutes = Array.isArray(rawRoutes) ? rawRoutes.map(sanitizeRoute).filter((route): route is LlmAgentRoute => route !== null) : [];

    for (const route of providedRoutes) {
      routeMap.set(route.agentId, route);
    }

    return Object.entries(DEFAULT_MODEL_ROUTING)
      .map(([agentId]) => {
        const candidate = routeMap.get(agentId);
        return {
          agentId: agentId as LlmAgentRoute['agentId'],
          providerId: candidate?.providerId ?? '',
          modelId: candidate?.modelId ?? '',
        };
      })
      .filter((route): route is LlmAgentRoute => route !== null);
  }

  const routeMap = new Map<string, LlmAgentRoute>();
  const providedRoutes = Array.isArray(rawRoutes) ? rawRoutes.map(sanitizeRoute).filter((route): route is LlmAgentRoute => route !== null) : [];
  for (const route of providedRoutes) {
    routeMap.set(route.agentId, route);
  }
  return Array.from(routeMap.values());
};

const sanitizeSettings = (
  raw: unknown,
  legacyStore: LegacyAppGlobalSettings,
  workspaceRoot: string,
  options: SanitizeSettingsOptions,
): AppSettings => {
  const fallback = createDefaultSettings(workspaceRoot);
  const candidate = (raw ?? {}) as LegacySettingsPayload;
  const appearance = (candidate.appearance ?? {}) as Partial<UiPreferences>;
  const profile = (candidate.profile ?? {}) as Partial<ProfileSettings>;
  const resolvedWorkspaceRoot = candidate.workspace?.rootPath?.trim() || workspaceRoot;
  const providers = mergeProviders(candidate.llm?.providers, candidate, legacyStore, options);
  const routes = sanitizeAgentRoutes(candidate.llm?.agentRoutes, options);

  return {
    appearance: {
      theme: pickEnum<AppTheme>(appearance.theme, VALID_THEMES, fallback.appearance.theme),
      language: pickEnum<AppLanguage>(appearance.language, VALID_LANGUAGES, fallback.appearance.language),
      fontScale: pickEnum<FontScale>(appearance.fontScale, VALID_FONT_SCALES, fallback.appearance.fontScale),
    },
    layout: {
      leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout.leftSidebar),
      rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout.rightPanel),
    },
    profile: {
      nickname: typeof profile.nickname === 'string' && profile.nickname.trim().length > 0
        ? profile.nickname.trim()
        : fallback.profile.nickname,
      avatarPath: typeof profile.avatarPath === 'string' ? profile.avatarPath : fallback.profile.avatarPath,
    },
    workspace: {
      rootPath: resolvedWorkspaceRoot,
    },
    llm: {
      providers,
      agentRoutes: routes,
    },
    paths: EMPTY_PATHS,
  };
};

const mergeSettings = (
  current: AppSettings,
  patch: AppSettingsPatch,
  workspaceRoot: string,
): AppSettings => sanitizeSettings({
  ...current,
  appearance: {
    ...current.appearance,
    ...(patch.appearance ?? {}),
  },
  layout: {
    leftSidebar: {
      ...current.layout.leftSidebar,
      ...(patch.layout?.leftSidebar ?? {}),
    },
    rightPanel: {
      ...current.layout.rightPanel,
      ...(patch.layout?.rightPanel ?? {}),
    },
  },
  profile: {
    ...current.profile,
    ...(patch.profile ?? {}),
  },
  workspace: {
    ...current.workspace,
    ...(patch.workspace ?? {}),
  },
  llm: {
    providers: patch.llm?.providers ?? current.llm.providers,
    agentRoutes: patch.llm?.agentRoutes ?? current.llm.agentRoutes,
  },
}, EMPTY_LEGACY_STORE, workspaceRoot, {
  seedBuiltins: false,
  importLegacy: false,
  seedDefaultRoutes: false,
});

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
    if (!this.hasPersistedSettings(runtimePaths.workspaceRoot)) {
      const initialSettings = this.createInitialSettings(runtimePaths.workspaceRoot);
      this.writeSettings(initialSettings, runtimePaths.workspaceRoot);
    }
    this.initialized = true;
    return this.getAll(runtimePaths);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private getSettingsFilePath(workspaceRoot: string): string {
    return appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
  }

  private hasPersistedSettings(workspaceRoot: string): boolean {
    return fs.existsSync(this.getSettingsFilePath(workspaceRoot));
  }

  private readJsonFile(filePath: string): unknown | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.warn('[SettingsService] Failed to read settings file:', error);
      return null;
    }
  }

  private readLegacySettings(): unknown | null {
    return this.readJsonFile(path.join(app.getPath('appData'), 'RdcAgent', 'settings.json'));
  }

  private readPersistedSettings(workspaceRoot: string): AppSettings {
    const rawSettings = this.readJsonFile(this.getSettingsFilePath(workspaceRoot));
    return sanitizeSettings(rawSettings, EMPTY_LEGACY_STORE, workspaceRoot, {
      seedBuiltins: false,
      importLegacy: false,
      seedDefaultRoutes: false,
    });
  }

  private createInitialSettings(workspaceRoot: string): AppSettings {
    const rawSettings = this.readLegacySettings();
    return sanitizeSettings(rawSettings, this.legacyStore.store, workspaceRoot, {
      seedBuiltins: false,
      importLegacy: true,
      seedDefaultRoutes: true,
    });
  }

  private writeSettings(settings: AppSettings, workspaceRoot = settings.workspace.rootPath): void {
    const settingsPath = this.getSettingsFilePath(workspaceRoot);
    const persisted: AppSettings = {
      ...settings,
      workspace: {
        rootPath: workspaceRoot,
      },
      paths: EMPTY_PATHS,
    };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), 'utf8');
  }

  getAll(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const paths = appPathService.getWorkspacePaths();
    const settings = this.hasPersistedSettings(paths.workspaceRoot)
      ? this.readPersistedSettings(paths.workspaceRoot)
      : this.createInitialSettings(paths.workspaceRoot);

    return {
      ...settings,
      workspace: {
        rootPath: paths.workspaceRoot,
      },
      paths: {
        ...paths,
        ...(runtimePaths ?? {}),
      },
    };
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const currentPaths = appPathService.getWorkspacePaths();
    const currentSettings = this.hasPersistedSettings(currentPaths.workspaceRoot)
      ? this.readPersistedSettings(currentPaths.workspaceRoot)
      : this.createInitialSettings(currentPaths.workspaceRoot);
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentSettings.workspace.rootPath || currentPaths.workspaceRoot;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    const baseSettings = this.hasPersistedSettings(nextPaths.workspaceRoot)
      ? this.readPersistedSettings(nextPaths.workspaceRoot)
      : {
          ...currentSettings,
          workspace: {
            rootPath: nextPaths.workspaceRoot,
          },
        };
    const nextSettings = mergeSettings(baseSettings, patch, nextPaths.workspaceRoot);
    this.writeSettings(nextSettings, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
  }

  getLlmConfig(): LLMConfig {
    const settings = this.getAll();
    const providers: LLMProviderConfig[] = settings.llm.providers.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      label: provider.label,
      enabled: provider.enabled,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      models: provider.models.filter((model) => model.enabled).map((model) => model.id),
      docsUrl: provider.docsUrl,
    }));

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
