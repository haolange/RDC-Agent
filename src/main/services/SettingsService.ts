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

const createDefaultAgentRoutes = (): LlmAgentRoute[] =>
  Object.entries(DEFAULT_MODEL_ROUTING).map(([agentId, route]) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: route.provider,
    modelId: route.model,
  }));

const createDefaultSettings = (): AppSettings => ({
  appearance: DEFAULT_APPEARANCE,
  layout: DEFAULT_LAYOUT,
  profile: DEFAULT_PROFILE,
  workspace: {
    rootPath: appPathService.getWorkspaceRoot(),
  },
  llm: {
    providers: createBuiltinProviderEntries(),
    agentRoutes: createDefaultAgentRoutes(),
  },
  paths: EMPTY_PATHS,
});

const toModelId = (value: string): string => value.trim();

const sanitizeModels = (models: unknown, fallback: string[] = []): LlmProviderModel[] => {
  const candidates = Array.isArray(models) ? models : [];
  const normalized = candidates
    .map((entry) => {
      if (typeof entry === 'string') {
        const modelId = toModelId(entry);
        return modelId ? { id: modelId, label: modelId, enabled: true } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as Partial<LlmProviderModel>;
      const modelId = typeof candidate.id === 'string' ? toModelId(candidate.id) : '';
      if (!modelId) {
        return null;
      }

      return {
        id: modelId,
        label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
        enabled: candidate.enabled !== false,
      } satisfies LlmProviderModel;
    })
    .filter((entry): entry is LlmProviderModel => entry !== null);

  const merged = dedupeStrings([
    ...normalized.filter((entry) => entry.enabled).map((entry) => entry.id),
    ...fallback,
  ]);

  return merged.map((modelId) => {
    const existing = normalized.find((entry) => entry.id === modelId);
    return existing ?? {
      id: modelId,
      label: modelId,
      enabled: true,
    };
  });
};

const getBuiltinDefinition = (providerId: string) =>
  BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === providerId);

const getProviderConfigState = (provider: Pick<LlmProviderEntry, 'enabled' | 'kind' | 'apiKey'>): boolean => {
  if (!provider.enabled) return false;
  if (provider.kind === 'ollama') return true;
  return Boolean(provider.apiKey.trim());
};

const sanitizeProvider = (entry: Partial<LlmProviderEntry>, fallback?: LlmProviderEntry): LlmProviderEntry => {
  const builtin = getBuiltinDefinition(typeof entry.id === 'string' ? entry.id : fallback?.id ?? '');
  const providerId = (typeof entry.id === 'string' && entry.id.trim()) || fallback?.id || builtin?.id || 'custom-provider';
  const recommendedModels = dedupeStrings([
    ...(Array.isArray(entry.recommendedModels) ? entry.recommendedModels.filter((value): value is string => typeof value === 'string') : []),
    ...(fallback?.recommendedModels ?? []),
    ...(builtin?.recommendedModels ?? []),
  ]);
  const models = sanitizeModels(
    entry.models,
    dedupeStrings([
      ...(fallback?.models ?? []).filter((model) => model.enabled).map((model) => model.id),
      ...(builtin?.defaultModels ?? []),
    ]),
  );
  const resolved: LlmProviderEntry = {
    id: providerId,
    kind: pickEnum<LlmProviderKind>(
      entry.kind,
      VALID_PROVIDER_KINDS,
      fallback?.kind ?? builtin?.kind ?? 'openai-compatible',
    ),
    label: typeof entry.label === 'string' && entry.label.trim()
      ? entry.label.trim()
      : fallback?.label ?? builtin?.label ?? providerId,
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : fallback?.enabled ?? builtin?.enabled ?? false,
    apiKey: typeof entry.apiKey === 'string' ? entry.apiKey.trim() : fallback?.apiKey ?? '',
    baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl.trim()
      ? entry.baseUrl.trim()
      : fallback?.baseUrl ?? builtin?.baseUrl,
    models,
    recommendedModels,
    docsUrl: typeof entry.docsUrl === 'string' && entry.docsUrl.trim()
      ? entry.docsUrl.trim()
      : fallback?.docsUrl ?? builtin?.docsUrl,
    isConfigured: false,
  };

  resolved.isConfigured = getProviderConfigState(resolved);
  return resolved;
};

const importLegacyCredentials = (settings: LegacySettingsPayload): LlmProviderEntry[] => {
  const credentials = Array.isArray(settings.llm?.credentials) ? settings.llm?.credentials : [];
  const imported = new Map<string, LegacyLlmCredentialEntry>();

  for (const credential of credentials) {
    const providerId = typeof credential.provider === 'string' ? credential.provider : '';
    if (!providerId || !credential.apiKey?.trim()) {
      continue;
    }

    const current = imported.get(providerId);
    if (!current || credential.isDefault) {
      imported.set(providerId, credential);
    }
  }

  return Array.from(imported.entries()).map(([providerId, credential]) => {
    const builtinFallback = createBuiltinProviderEntries().find((entry) => entry.id === providerId);
    return sanitizeProvider({
      id: providerId as LlmProviderId,
      label: credential.label || builtinFallback?.label || providerId,
      enabled: true,
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      models: builtinFallback?.models ?? [],
      recommendedModels: builtinFallback?.recommendedModels ?? [],
      docsUrl: builtinFallback?.docsUrl,
      kind: builtinFallback?.kind ?? 'openai-compatible',
    }, builtinFallback);
  });
};

const mergeProviders = (rawProviders: unknown, legacySettings: LegacySettingsPayload, legacyStore: LegacyAppGlobalSettings): LlmProviderEntry[] => {
  const builtinProviders = createBuiltinProviderEntries();
  const providerMap = new Map<string, LlmProviderEntry>();

  for (const provider of builtinProviders) {
    providerMap.set(provider.id, provider);
  }

  const importedProviders = Array.isArray(rawProviders)
    ? rawProviders.map((entry) => sanitizeProvider(entry as Partial<LlmProviderEntry>, providerMap.get((entry as LlmProviderEntry).id)))
    : [];
  for (const provider of importedProviders) {
    providerMap.set(provider.id, provider);
  }

  for (const provider of importLegacyCredentials(legacySettings)) {
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

  return Array.from(providerMap.values()).map((provider) => sanitizeProvider(provider, providerMap.get(provider.id)));
};

const ensureRouteModel = (provider: LlmProviderEntry, modelId: string): LlmProviderEntry => {
  if (!modelId) {
    return provider;
  }

  if (provider.models.some((model) => model.id === modelId)) {
    return provider;
  }

  return {
    ...provider,
    models: [...provider.models, { id: modelId, label: modelId, enabled: true }],
  };
};

const sanitizeAgentRoutes = (rawRoutes: unknown, providers: LlmProviderEntry[]): { providers: LlmProviderEntry[]; routes: LlmAgentRoute[] } => {
  const providerMap = new Map<string, LlmProviderEntry>(providers.map((provider) => [provider.id, provider]));
  const providedRoutes = Array.isArray(rawRoutes)
    ? rawRoutes.filter((entry): entry is LlmAgentRoute => Boolean(entry && typeof entry === 'object' && 'agentId' in entry))
    : [];
  const routeMap = new Map(providedRoutes.map((route) => [route.agentId, route]));
  const normalizedRoutes: LlmAgentRoute[] = [];

  for (const [agentId, fallback] of Object.entries(DEFAULT_MODEL_ROUTING)) {
    const candidate = routeMap.get(agentId as LlmAgentRoute['agentId']);
    const providerId = candidate?.providerId || fallback.provider;
    const preferredModelId = candidate?.modelId || fallback.model;
    const initialProvider = providerMap.get(providerId) || providerMap.get(fallback.provider) || providers[0];

    if (!initialProvider) {
      continue;
    }

    const providerWithModel = ensureRouteModel(initialProvider, preferredModelId);
    providerMap.set(providerWithModel.id, providerWithModel);

    normalizedRoutes.push({
      agentId: agentId as LlmAgentRoute['agentId'],
      providerId: providerWithModel.id,
      modelId: preferredModelId,
    });
  }

  return {
    providers: Array.from(providerMap.values()).map((provider) => sanitizeProvider(provider, provider)),
    routes: normalizedRoutes,
  };
};

const sanitizeSettings = (
  raw: unknown,
  legacyStore: LegacyAppGlobalSettings,
  workspaceRoot: string,
): AppSettings => {
  const fallback = createDefaultSettings();
  const candidate = (raw ?? {}) as LegacySettingsPayload;
  const appearance = (candidate.appearance ?? {}) as Partial<UiPreferences>;
  const profile = (candidate.profile ?? {}) as Partial<ProfileSettings>;
  const resolvedWorkspaceRoot = candidate.workspace?.rootPath?.trim() || workspaceRoot;
  const providers = mergeProviders(candidate.llm?.providers, candidate, legacyStore);
  const { providers: normalizedProviders, routes } = sanitizeAgentRoutes(candidate.llm?.agentRoutes, providers);

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
      providers: normalizedProviders,
      agentRoutes: routes,
    },
    paths: EMPTY_PATHS,
  };
};

const mergeSettings = (
  current: AppSettings,
  patch: AppSettingsPatch,
  legacyStore: LegacyAppGlobalSettings,
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
}, legacyStore, workspaceRoot);

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
    const settings = this.readSettings(runtimePaths.workspaceRoot);
    this.writeSettings(settings, runtimePaths.workspaceRoot);
    this.initialized = true;
    return this.getAll(runtimePaths);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private readSettings(workspaceRoot: string): AppSettings {
    const settingsPath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    const legacySettingsPath = path.join(app.getPath('appData'), 'RdcAgent', 'settings.json');
    let rawSettings: unknown = null;

    try {
      if (fs.existsSync(settingsPath)) {
        rawSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } else if (fs.existsSync(legacySettingsPath)) {
        rawSettings = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf8'));
      }
    } catch (error) {
      console.warn('[SettingsService] Failed to read settings file:', error);
    }

    return sanitizeSettings(rawSettings, this.legacyStore.store, workspaceRoot);
  }

  private writeSettings(settings: AppSettings, workspaceRoot = settings.workspace.rootPath): void {
    const settingsPath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
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
    const settings = this.readSettings(paths.workspaceRoot);
    const nextSettings: AppSettings = {
      ...settings,
      workspace: {
        rootPath: paths.workspaceRoot,
      },
      paths: {
        ...paths,
        ...(runtimePaths ?? {}),
      },
    };

    this.writeSettings(nextSettings, paths.workspaceRoot);
    return nextSettings;
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const currentSettings = this.getAll(runtimePaths);
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentSettings.workspace.rootPath;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    const nextSettings = mergeSettings(currentSettings, patch, this.legacyStore.store, nextPaths.workspaceRoot);
    this.writeSettings(nextSettings, nextPaths.workspaceRoot);
    return this.getAll(nextPaths);
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
