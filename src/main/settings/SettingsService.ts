import fs from 'fs';
import path from 'path';
import type {
  AppLanguage,
  AppRuntimePaths,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRuntimeSettings,
  ConfigurationSettings,
  FontScale,
  LayoutPreferences,
  LlmAgentRoute,
  LlmProviderConnectionStatus,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  ProfileSettings,
  RdxActionId,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  RdxShellActionSettings,
  SidebarLayoutPreference,
  ToolingSettings,
  UiPreferences,
  WorkspaceSettings,
} from '@shared/types/settings';
import type { LLMConfig, LLMProviderConfig } from '@shared/types/llm';
import { DEFAULT_MODEL_ROUTING, isSafeAgentProfileId } from '@shared/types/agent';
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
import { agentManifestService } from './AgentManifestService';
import { executionProfileService } from './ExecutionProfileService';
import { providerCatalogService } from './ProviderCatalogService';
import { normalizeProviderCategory, normalizeProviderProtocol } from './providerCatalogNormalize';
import { secretStorageService } from './SecretStorageService';

interface PersistedConfigurationSettings {
  activeModeProfileId?: string;
  // Legacy persisted field only. Markdown Skills are available by file presence.
  enabledSkillIds?: string[];
  enabledMcpServerIds?: string[];
  modePatternBindings?: Record<string, string>;
  lastMigrationReportPath?: string;
}

type PersistedLlmProviderEntry = Partial<LlmProviderEntry> & {
  kind?: unknown;
  catalogGroup?: unknown;
};

interface PersistedSettingsPayload {
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
  workspace?: Partial<WorkspaceSettings>;
  llm?: {
    providers?: PersistedLlmProviderEntry[];
    agentRoutes?: LlmAgentRoute[];
  };
  tooling?: {
    rdxCli?: Partial<RdxCliInvokerSettings>;
    rdxActions?: Partial<Record<RdxActionId, Partial<RdxShellActionSettings>>>;
  };
  agentRuntime?: {
    permissions?: Partial<AgentPermissionSettings>;
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
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
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
const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['default', 'auto-review', 'full-access', 'custom'];
const RETIRED_BUILTIN_MCP_SERVER_IDS = new Set(['builtin.rdc-toolbridge']);
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
  skillsPath: '',
  mcpPath: '',
  patternsPath: '',
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
  enabledMcpServerIds: [],
  modePatternBindings: {
    debugger: 'free-agent',
    analyzer: 'free-agent',
    optimizer: 'free-agent',
  },
};

const DEFAULT_RDX_CLI_INVOKER: RdxCliInvokerSettings = {
  enabled: false,
  command: '',
  argsPrefix: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
  catalogPath: '',
  jsonMode: 'auto',
};

const createDefaultRdxAction = (): RdxShellActionSettings => ({
  enabled: false,
  command: '',
  args: [],
  workingDirectory: '',
  env: {},
  timeoutMs: 60000,
});

const DEFAULT_RDX_ACTIONS: RdxActionSettingsMap = {
  openCapture: createDefaultRdxAction(),
  connectRemote: createDefaultRdxAction(),
  closeRuntime: createDefaultRdxAction(),
  openPreview: createDefaultRdxAction(),
};

const DEFAULT_TOOLING: ToolingSettings = {
  rdxCli: DEFAULT_RDX_CLI_INVOKER,
  rdxActions: DEFAULT_RDX_ACTIONS,
};

const DEFAULT_AGENT_RUNTIME: AgentRuntimeSettings = {
  permissions: {
    mode: 'default',
    readableRoots: [],
    writableRoots: [],
    allowedCommandPrefixes: [],
    deniedCommandPrefixes: [],
  },
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

function sanitizeRuntimeIds(values: unknown): string[] {
  return dedupeStrings(
    Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string').map((value) => value.trim())
      : [],
  ).filter((value) => !RETIRED_BUILTIN_MCP_SERVER_IDS.has(value));
}

function sanitizePatternBindings(value: unknown): Record<string, string> {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const bindings: Record<string, string> = {};
  for (const [mode, patternId] of Object.entries(candidate)) {
    if (typeof patternId === 'string' && patternId.trim()) {
      bindings[mode] = patternId.trim();
    }
  }
  return {
    ...(DEFAULT_CONFIGURATION.modePatternBindings ?? {}),
    ...bindings,
  };
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sanitized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const cleanKey = key.trim();
    if (!cleanKey || typeof entry !== 'string') {
      continue;
    }
    sanitized[cleanKey] = entry;
  }
  return sanitized;
}

function sanitizeRdxCliInvokerSettings(
  value: unknown,
  fallback: RdxCliInvokerSettings = DEFAULT_RDX_CLI_INVOKER,
): RdxCliInvokerSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<RdxCliInvokerSettings> : {};
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? clamp(Math.trunc(candidate.timeoutMs), 1000, 600000)
    : fallback.timeoutMs;

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === 'string' ? candidate.command.trim() : fallback.command,
    argsPrefix: sanitizeStringArray(candidate.argsPrefix ?? fallback.argsPrefix),
    workingDirectory: typeof candidate.workingDirectory === 'string' ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs,
    catalogPath: typeof candidate.catalogPath === 'string' ? candidate.catalogPath.trim() : fallback.catalogPath,
    jsonMode: pickEnum(candidate.jsonMode, ['auto', 'always'], fallback.jsonMode),
  };
}

function sanitizeRdxShellActionSettings(
  value: unknown,
  fallback: RdxShellActionSettings = createDefaultRdxAction(),
): RdxShellActionSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<RdxShellActionSettings> : {};
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? clamp(Math.trunc(candidate.timeoutMs), 1000, 600000)
    : fallback.timeoutMs;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === 'string' ? candidate.command.trim() : fallback.command,
    args: sanitizeStringArray(candidate.args ?? fallback.args),
    workingDirectory: typeof candidate.workingDirectory === 'string' ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs,
  };
}

function sanitizeRdxActionsSettings(value: unknown): RdxActionSettingsMap {
  const candidate = value && typeof value === 'object' ? value as Partial<Record<RdxActionId, unknown>> : {};
  return {
    openCapture: sanitizeRdxShellActionSettings(candidate.openCapture, DEFAULT_RDX_ACTIONS.openCapture),
    connectRemote: sanitizeRdxShellActionSettings(candidate.connectRemote, DEFAULT_RDX_ACTIONS.connectRemote),
    closeRuntime: sanitizeRdxShellActionSettings(candidate.closeRuntime, DEFAULT_RDX_ACTIONS.closeRuntime),
    openPreview: sanitizeRdxShellActionSettings(candidate.openPreview, DEFAULT_RDX_ACTIONS.openPreview),
  };
}

function sanitizeToolingSettings(value: unknown): ToolingSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<ToolingSettings> : {};
  return {
    rdxCli: sanitizeRdxCliInvokerSettings(candidate.rdxCli),
    rdxActions: sanitizeRdxActionsSettings(candidate.rdxActions),
  };
}

function sanitizePathList(value: unknown): string[] {
  return dedupeStrings(
    sanitizeStringArray(value).map((entry) => path.resolve(expandHomePath(entry))),
  );
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') return process.env.USERPROFILE || process.env.HOME || trimmed;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return home ? path.join(home, trimmed.slice(2)) : trimmed;
  }
  return trimmed.replace(/^%USERPROFILE%/i, process.env.USERPROFILE || '%USERPROFILE%');
}

function sanitizeAgentPermissionSettings(
  value: unknown,
  fallback: AgentPermissionSettings = DEFAULT_AGENT_RUNTIME.permissions,
): AgentPermissionSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentPermissionSettings> : {};
  return {
    mode: pickEnum(candidate.mode, VALID_PERMISSION_MODES, fallback.mode),
    readableRoots: sanitizePathList(candidate.readableRoots ?? fallback.readableRoots),
    writableRoots: sanitizePathList(candidate.writableRoots ?? fallback.writableRoots),
    allowedCommandPrefixes: sanitizeStringArray(candidate.allowedCommandPrefixes ?? fallback.allowedCommandPrefixes),
    deniedCommandPrefixes: sanitizeStringArray(candidate.deniedCommandPrefixes ?? fallback.deniedCommandPrefixes),
    configPath: typeof candidate.configPath === 'string' && candidate.configPath.trim()
      ? path.resolve(expandHomePath(candidate.configPath.trim()))
      : undefined,
  };
}

function sanitizeAgentRuntimeSettings(value: unknown): AgentRuntimeSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<AgentRuntimeSettings> : {};
  return {
    permissions: sanitizeAgentPermissionSettings(candidate.permissions),
  };
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
    if (providerId === 'grok-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://api.x.ai/v1',
      };
    }
    if (providerId === 'gemini-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      };
    }
    if (providerId === 'qwen-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
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
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
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
    enabledMcpServerIds: DEFAULT_CONFIGURATION.enabledMcpServerIds ?? [],
    modePatternBindings: DEFAULT_CONFIGURATION.modePatternBindings ?? {},
    availablePatterns: [],
    availableSkills: [],
    availableMcpServers: [],
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
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes(),
    },
    agents: {
      directoryPath: path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, 'agents'),
      definitions: [],
      modelOptions: [],
      globalInstructions: '',
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
  if (typeof route.agentId !== 'string' || !isSafeAgentProfileId(route.agentId)) {
    return null;
  }

  return {
    agentId: route.agentId as LlmAgentRoute['agentId'],
    providerId: typeof route.providerId === 'string' ? normalizeRetiredProviderId(route.providerId.trim()) : '',
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

const RETIRED_PROVIDER_ID_IMPORTS: Record<string, LlmProviderId> = {
  gemini: 'vertex',
  kimi: 'kimi-coding-plan',
  'kimi-code': 'kimi-coding-plan',
  minimax: 'minimax-global',
  zai: 'glm-global',
};

function normalizeRetiredProviderId(providerId: string): string {
  return RETIRED_PROVIDER_ID_IMPORTS[providerId] ?? providerId;
}

function sanitizeUserProvider(
  provider: PersistedLlmProviderEntry,
  workspaceRoot = appPathService.getWorkspaceRoot(),
): LlmProviderEntry | null {
  const incomingId = typeof provider.id === 'string' ? provider.id.trim() : '';
  const rawId = normalizeRetiredProviderId(incomingId);
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }

  const builtinFallback = createBuiltinProviderEntry(rawId);
  const definition = getBuiltinProviderDefinition(rawId);
  const incomingSecretRef = typeof provider.secretRef === 'string' && provider.secretRef.trim()
    ? provider.secretRef.trim()
    : undefined;
  const secretRef = incomingId && incomingId !== rawId
    ? secretStorageService.createProviderSecretRef(rawId)
    : incomingSecretRef || secretStorageService.createProviderSecretRef(rawId);
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const models = sanitizeModels(provider.models ?? []);
  const oauthSecretRef = secretStorageService.createProviderOAuthSecretRef(rawId);
  const resolvedSecret = builtinFallback.authMode === 'api-key'
    ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot)
    : builtinFallback.authMode === 'account'
      ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot)
      : '';
  const hasStoredSecret = builtinFallback.hasStoredSecret || Boolean(resolvedSecret);
  const canUseProvider = builtinFallback.status !== 'unavailable' && (builtinFallback.authMode === 'local' || builtinFallback.authMode === 'environment'
    ? true
    : Boolean(resolvedSecret));
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const enabled = status === 'verified' && models.length > 0;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;

  return {
    id: rawId,
    protocol,
    authMode: builtinFallback.authMode,
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode: builtinFallback.authMode }),
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
    protocolEditable: definition?.protocolEditable,
    protocolOptions: builtinFallback.protocolOptions,
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
    capabilities: definition?.capabilities ? [...definition.capabilities] : undefined,
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
  const routeMap = new Map<string, LlmAgentRoute>(
    createEmptyAgentRoutes().map((route) => [route.agentId, route]),
  );
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }

  for (const [agentId, incoming] of routeMap.entries()) {
    if (!incoming.providerId || !incoming.modelId) {
      routeMap.set(agentId, { agentId, providerId: '', modelId: '' });
      continue;
    }

    const provider = providers.find((entry) => entry.id === incoming.providerId);
    const isValid = Boolean(
      provider
      && provider.isConfigured
      && provider.models.some((model) => model.id === incoming.modelId && model.enabled !== false),
    );

    if (!isValid) {
      routeMap.set(agentId, { agentId, providerId: '', modelId: '' });
    }
  }

  return Array.from(routeMap.values());
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
  private initialized = false;

  initialize(): AppSettings {
    const runtimePaths = appPathService.initializeWorkspaceRoot();
    executionProfileService.ensureScaffold(runtimePaths.workspaceRoot);

    const rawPersisted = readJsonFile<PersistedSettingsPayload>(runtimePaths.settingsPath);
    const rebuildResult = this.rebuildPersistedSettings(rawPersisted, runtimePaths.workspaceRoot);
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
  ): HardRebuildResult {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const fixes: string[] = [];
    const warnings: string[] = [];
    const persistedRawProviders = Array.isArray(candidate.llm?.providers) ? candidate.llm?.providers : [];
    const persistedRawRoutes = Array.isArray(candidate.llm?.agentRoutes) ? candidate.llm?.agentRoutes : [];

    const rawProviders = persistedRawProviders;
    const rawRoutes = persistedRawRoutes;

    const nextProviders: LlmProviderEntry[] = [];
    for (const entry of rawProviders) {
      if (isFixtureProvider(entry)) {
        fixes.push(`Removed fixture provider ${entry.id}`);
        secretStorageService.deleteSecret(entry.secretRef, workspaceRoot);
        continue;
      }

      const incomingId = typeof entry.id === 'string' ? entry.id.trim() : '';
      const rawId = normalizeRetiredProviderId(incomingId);
      if (!rawId) {
        fixes.push('Removed provider with empty id');
        continue;
      }

      if (incomingId && incomingId !== rawId) {
        fixes.push(`Renamed retired provider id ${incomingId} to ${rawId}`);
      }

      const canonicalSecretRef = secretStorageService.createProviderSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === 'string' && entry.secretRef.trim()
        ? entry.secretRef.trim()
        : undefined;
      const secretRef = incomingId && incomingId !== rawId ? canonicalSecretRef : incomingSecretRef || canonicalSecretRef;
      if (incomingSecretRef && incomingSecretRef !== secretRef) {
        const incomingSecret = secretStorageService.getSecret(incomingSecretRef, workspaceRoot);
        if (incomingSecret.trim()) {
          secretStorageService.setSecret(secretRef, incomingSecret, workspaceRoot);
          secretStorageService.deleteSecret(incomingSecretRef, workspaceRoot);
          fixes.push(`Moved retired provider secret ${incomingId} to ${rawId}`);
        }
      }
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

    const catalogProviders = normalizeUserProviders(nextProviders, workspaceRoot);
    const normalizedRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
    const nextRoutes = normalizedRoutes;
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map((entry) => {
      if (entry && typeof entry === 'object') {
        const providerId = (entry as Partial<LlmAgentRoute>).providerId;
        const incomingProviderId = typeof providerId === 'string' ? providerId.trim() : '';
        const normalizedProviderId = normalizeRetiredProviderId(incomingProviderId);
        if (incomingProviderId && incomingProviderId !== normalizedProviderId) {
          const agentId = (entry as Partial<LlmAgentRoute>).agentId;
          fixes.push(`Renamed retired route provider id ${incomingProviderId} to ${normalizedProviderId}${typeof agentId === 'string' ? ` for ${agentId}` : ''}`);
        }
      }
      return sanitizeRoute(entry);
    }).filter((route): route is LlmAgentRoute => route !== null) : [];
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
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: '' })),
        agentRoutes: nextRoutes,
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
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
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes,
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
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
      enabledMcpServerIds: normalized.configuration?.enabledMcpServerIds ?? [],
      modePatternBindings: normalized.configuration?.modePatternBindings ?? DEFAULT_CONFIGURATION.modePatternBindings ?? {},
      availablePatterns: [],
      availableSkills: [],
      availableMcpServers: [],
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
      tooling: normalized.tooling,
      agentRuntime: normalized.agentRuntime,
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders),
      },
      agents: agentManifestService.getSettings(paths, hydratedProviders, normalized.llm?.agentRoutes ?? createEmptyAgentRoutes()),
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
    const currentRoutes = normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? [], nextProviders);
    if (patch.agents?.definitions) {
      agentManifestService.save(
        nextPaths,
        patch.agents.definitions,
        patch.agents.globalInstructions,
      );
    } else if (typeof patch.agents?.globalInstructions === 'string') {
      agentManifestService.save(nextPaths, [], patch.agents.globalInstructions);
    }
    const manifestRoutes = patch.agents?.definitions
      ? agentManifestService.routesFromDefinitions(currentRoutes, patch.agents.definitions, nextProviders)
      : currentRoutes;

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
      tooling: {
        rdxCli: sanitizeRdxCliInvokerSettings({
          ...(currentPersisted.tooling?.rdxCli ?? DEFAULT_RDX_CLI_INVOKER),
          ...(patch.tooling?.rdxCli ?? {}),
        }),
        rdxActions: sanitizeRdxActionsSettings({
          ...(currentPersisted.tooling?.rdxActions ?? DEFAULT_RDX_ACTIONS),
          ...(patch.tooling?.rdxActions ?? {}),
        }),
      },
      agentRuntime: {
        permissions: sanitizeAgentPermissionSettings({
          ...(currentPersisted.agentRuntime?.permissions ?? DEFAULT_AGENT_RUNTIME.permissions),
          ...(patch.agentRuntime?.permissions ?? {}),
        }),
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: '' })),
        agentRoutes: normalizeUserRoutes(manifestRoutes, nextProviders),
      },
      configuration: {
        activeModeProfileId: patch.configuration?.activeModeProfileId
          || currentPersisted.configuration?.activeModeProfileId
          || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: patch.configuration?.enabledMcpServerIds
          ? sanitizeRuntimeIds(patch.configuration.enabledMcpServerIds)
          : sanitizeRuntimeIds(currentPersisted.configuration?.enabledMcpServerIds),
        modePatternBindings: patch.configuration?.modePatternBindings
          ? sanitizePatternBindings(patch.configuration.modePatternBindings)
          : sanitizePatternBindings(currentPersisted.configuration?.modePatternBindings),
        lastMigrationReportPath: currentPersisted.configuration?.lastMigrationReportPath,
      },
    };

    this.writeSettings(nextPersisted, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
  }

  saveProviderConnection(
    providerId: LlmProviderId,
    apiKey: string,
    models: LlmProviderModel[],
    baseUrl = '',
    protocolDraft?: unknown,
  ): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error('该 Provider 暂未返回可用模型');
    }

    const protocol = normalizeProviderProtocol({ id: provider.id, protocol: protocolDraft ?? provider.protocol });
    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      apiKey: apiKey.trim(),
      protocol,
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
          protocol: provider.protocol,
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

  getProviderCatalog() {
    return providerCatalogService.getProviderCatalog();
  }

  hasConfiguredProvider(): boolean {
    return this.getAll().llm.providers.some((provider) => provider.isConfigured);
  }

  getSettingsPath(): string {
    return appPathService.getWorkspacePaths().settingsPath;
  }
}

export const settingsService = new SettingsService();
