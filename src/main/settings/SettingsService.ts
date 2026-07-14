import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  AppLanguage,
  AppRuntimePaths,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  AgentPermissionMode,
  AgentPermissionSettings,
  AgentRuntimeSettings,
  RuntimeResourceCatalog,
  FontScale,
  LayoutPreferences,
  LlmAgentRoute,
  LlmProviderAuthMode,
  LlmProviderAvailability,
  LlmProviderConnectionStatus,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProfileSettings,
  RdxActionId,
  RdxActionSettingsMap,
  RdxCliInvokerSettings,
  RdxShellActionSettings,
  SidebarLayoutPreference,
  ToolingSettings,
  UiPreferences,
} from '@shared/types/settings';
import { isReasoningSelection } from '@shared/types/modelCapability';
import type {
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
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
  createProviderEntryFromPreset,
  createProviderEntriesFromPresets,
  getProviderPresetCatalogOwnership,
  getProviderPresetAuthModeAvailability,
  getProviderPresetProtocolBaseUrls,
  getProviderPresetProtocolOptions,
  getProviderSeedModels,
  isBuiltinProviderId,
  resolveProviderPresetBaseUrl as resolveBuiltinProtocolBaseUrl,
} from './ProviderPresetRegistry';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';
import { executionProfileService } from './ExecutionProfileService';
import { providerCatalogService } from './ProviderCatalogService';
import { normalizeProviderCategory, normalizeProviderProtocol } from './providerCatalogNormalize';
import { secretStorageService } from './SecretStorageService';
import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';

type PersistedLlmProviderEntry = Partial<LlmProviderEntry>;

interface PersistedSettingsPayload {
  schemaVersion?: number;
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
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
}

interface HardRebuildResult {
  settings: PersistedSettingsPayload;
  changed: boolean;
  fixes: string[];
  warnings: string[];
  secretRefsToDelete: string[];
}

interface NormalizedPersistedSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  llm: {
    providers: LlmProviderEntry[];
    agentRoutes: LlmAgentRoute[];
  };
}

const SETTINGS_SCHEMA_VERSION = 2;

type ProviderCredentialView = 'runtime' | 'storage-metadata';

interface ProviderSanitizeOptions {
  credentialView?: ProviderCredentialView;
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
const EMPTY_PATHS: AppRuntimePaths = {
  userRdxRoot: '',
  settingsPath: '',
  instructionsPath: '',
  agentsPath: '',
  profileStatePath: '',
  logsPath: '',
  logPath: '',
  projectsPath: '',
  knowledgePath: '',
  policiesPath: '',
  skillsPath: '',
  mcpPath: '',
  secretsPath: '',
};

const DEFAULT_APPEARANCE: UiPreferences = {
  theme: 'dark',
  language: 'zh-CN',
  fontScale: 'medium',
  composerMarkdown: false,
  usePointerCursors: false,
  contextBreakdownExpanded: false,
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

function createLocalAccountId(): string {
  return `account-${randomUUID()}`;
}

function extractOAuthBundleAccountId(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const accountId = (JSON.parse(raw) as { accountId?: unknown }).accountId;
    return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function getProviderAccountSecretRef(
  providerId: string,
  accountId: string | undefined,
  kind: 'api-key' | 'oauth',
): string | undefined {
  return accountId
    ? secretStorageService.createProviderAccountSecretRef(providerId, accountId, kind)
    : undefined;
}

function resolveProviderAuthMode(
  provider: Partial<LlmProviderEntry>,
  fallback: LlmProviderEntry,
): LlmProviderAuthMode {
  const options = fallback.authModeOptions ?? [fallback.authMode];
  return typeof provider.authMode === 'string' && options.includes(provider.authMode)
    ? provider.authMode
    : fallback.authMode;
}

function sanitizeAuthAccountIds(
  provider: Partial<LlmProviderEntry>,
  selectedMode: LlmProviderAuthMode,
): Partial<Record<LlmProviderAuthMode, string>> {
  const result: Partial<Record<LlmProviderAuthMode, string>> = {};
  if (provider.authAccountIds && typeof provider.authAccountIds === 'object') {
    for (const mode of ['api-key', 'account', 'local', 'environment'] as const) {
      const accountId = provider.authAccountIds[mode];
      if (typeof accountId === 'string' && accountId.trim()) result[mode] = accountId.trim();
    }
  }
  if (!result[selectedMode] && typeof provider.activeAccountId === 'string' && provider.activeAccountId.trim()) {
    result[selectedMode] = provider.activeAccountId.trim();
  }
  return result;
}

function resolveSelectedAuthAvailability(
  providerId: string,
  mode: LlmProviderAuthMode,
  fallback: LlmProviderEntry,
): LlmProviderAvailability {
  return getProviderPresetAuthModeAvailability(providerId)[mode]
    ?? fallback.authModeAvailability?.[mode]
    ?? fallback.providerAvailability;
}

function resolveAccountRuntimeCredential(
  provider: Pick<LlmProviderEntry, 'id' | 'activeAccountId'>,
  workspaceRoot: string,
): { apiKey: string; baseUrl?: string; accountId?: string } {
  const providerId = provider.id;
  const raw = secretStorageService.getSecret(
    getProviderAccountSecretRef(providerId, provider.activeAccountId, 'oauth'),
    workspaceRoot,
  );
  if (!raw) {
    return { apiKey: '' };
  }
  try {
    const bundle = JSON.parse(raw) as {
      accessToken?: string;
      apiKey?: string;
      copilotToken?: string;
      copilotApiBaseUrl?: string;
      inferenceBaseUrl?: string;
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
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        accountId: bundle.accountId,
      };
    }
    if (providerId === 'openrouter') {
      return {
        apiKey: bundle.apiKey ?? bundle.accessToken ?? '',
        baseUrl: 'https://openrouter.ai/api/v1',
        accountId: bundle.accountId,
      };
    }
    if (providerId === 'minimax-account') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: bundle.inferenceBaseUrl ?? 'https://api.minimax.io/anthropic',
        accountId: bundle.accountId,
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
      accountId: bundle.accountId,
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
    const availability = candidate.availability === 'available'
      || candidate.availability === 'unavailable'
      || candidate.availability === 'unknown'
      ? candidate.availability
      : undefined;

    const aliases = Array.isArray(candidate.aliases)
      ? [...new Set(candidate.aliases.filter((value): value is string => (
          typeof value === 'string' && Boolean(value.trim()) && value.trim() !== modelId
        )).map((value) => value.trim()))]
      : [];
    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
      defaultReasoningSelection: isReasoningSelection(candidate.defaultReasoningSelection)
        ? candidate.defaultReasoningSelection
        : undefined,
      defaultBudgetTokens: typeof candidate.defaultBudgetTokens === 'number'
        && Number.isSafeInteger(candidate.defaultBudgetTokens)
        && candidate.defaultBudgetTokens > 0
        ? candidate.defaultBudgetTokens
        : undefined,
      ...(aliases.length > 0 ? { aliases } : {}),
      availability,
      availabilityReason: typeof candidate.availabilityReason === 'string' && candidate.availabilityReason.trim()
        ? candidate.availabilityReason.trim()
        : undefined,
    });
  }

  return Array.from(modelMap.values());
}

function applyModelEnabledState(
  catalogModels: LlmProviderModel[],
  persistedModels: LlmProviderModel[],
): LlmProviderModel[] {
  const persistedById = new Map(persistedModels.map((model) => [model.id, model]));
  return catalogModels.map((model) => ({
    ...model,
    enabled: persistedById.get(model.id)?.enabled ?? true,
    defaultReasoningSelection: persistedById.get(model.id)?.defaultReasoningSelection,
    defaultBudgetTokens: persistedById.get(model.id)?.defaultBudgetTokens,
    availability: persistedById.get(model.id)?.availability ?? model.availability,
    availabilityReason: persistedById.get(model.id)?.availabilityReason,
  }));
}

function applyModelPreferences(
  models: LlmProviderModel[],
  preferences: readonly LlmProviderModelPreference[] | undefined,
): LlmProviderModel[] {
  if (!preferences?.length) return models;
  const byId = new Map(preferences.map((preference) => [preference.id, preference]));
  return models.map((model) => {
    const preference = byId.get(model.id);
    if (!preference) return model;
    return {
      ...model,
      enabled: preference.enabled,
      defaultReasoningSelection: isReasoningSelection(preference.defaultReasoningSelection)
        ? preference.defaultReasoningSelection
        : undefined,
      defaultBudgetTokens: typeof preference.defaultBudgetTokens === 'number'
        && Number.isSafeInteger(preference.defaultBudgetTokens)
        && preference.defaultBudgetTokens > 0
        ? preference.defaultBudgetTokens
        : undefined,
    };
  });
}

function resolveProviderModels(providerId: string, persistedModels: unknown): LlmProviderModel[] {
  const sanitized = sanitizeModels(persistedModels);
  if (getProviderPresetCatalogOwnership(providerId) !== 'app-managed') {
    return sanitized;
  }
  const admittedDynamicModels = sanitized.filter((model) => (
    isAdmittedDiscoveredModel({ id: model.id })
  ));
  // Volc Coding Plan discovery is account-specific. Once a verified subset has
  // been persisted, do not re-expand it to the entire application catalog.
  if (providerId === 'volcengine-coding-plan' && admittedDynamicModels.length > 0) {
    return admittedDynamicModels;
  }
  const catalogModels = getProviderSeedModels(providerId);
  return catalogModels.length > 0
    ? applyModelEnabledState(catalogModels, sanitized)
    : admittedDynamicModels;
}

function createEmptyAgentRoutes(): LlmAgentRoute[] {
  return Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));
}

function createDefaultPersistedSettings(): PersistedSettingsPayload {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes(),
    },
  };
}

function createDefaultRuntimeSettings(): AppSettings {
  const resourceCatalog = executionProfileService.normalizeResourceCatalog({
    availableSkills: [],
    availableMcpServers: [],
    diagnostics: [],
  });

  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes(),
    },
    agents: {
      directoryPath: appPathService.getRuntimePaths().agentsPath,
      definitions: [],
      modelOptions: [],
      globalInstructions: '',
    },
    resourceCatalog,
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
  const hasEnabledModels = models.some((model) => model.enabled !== false);
  if (fallback.status === 'unavailable') {
    return 'unavailable';
  }
  if (provider.status === 'failed') {
    return 'failed';
  }
  if ((provider.status === 'verified' || provider.isConfigured === true) && canUseProvider && hasEnabledModels) {
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

function sanitizeUserProvider(
  provider: PersistedLlmProviderEntry,
  workspaceRoot = appPathService.getUserRdxRoot(),
  options: ProviderSanitizeOptions = {},
): LlmProviderEntry | null {
  const incomingId = typeof provider.id === 'string' ? provider.id.trim() : '';
  const rawId = incomingId;
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }

  const builtinFallback = createProviderEntryFromPreset(rawId);
  const definition = builtinFallback;
  const authMode = resolveProviderAuthMode(provider, builtinFallback);
  const authAccountIds = sanitizeAuthAccountIds(provider, authMode);
  const activeAccountId = authAccountIds[authMode];
  const secretRef = getProviderAccountSecretRef(rawId, authAccountIds['api-key'], 'api-key');
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const catalogOwnership = getProviderPresetCatalogOwnership(rawId);
  const apiKeySecret = getResolvedProviderSecret(rawId, secretRef, workspaceRoot);
  const oauthSecret = secretStorageService.getSecret(
    getProviderAccountSecretRef(rawId, authAccountIds.account, 'oauth'),
    workspaceRoot,
  );
  const preserveStorageMetadata = options.credentialView === 'storage-metadata';
  const hasStoredSecretByAuthMode = Object.fromEntries(
    (builtinFallback.authModeOptions ?? [builtinFallback.authMode]).map((mode) => {
      const persisted = preserveStorageMetadata && (
        provider.hasStoredSecretByAuthMode?.[mode] === true
        || (mode === authMode && provider.hasStoredSecret === true)
      );
      const present = mode === 'local' || mode === 'environment'
        ? true
        : mode === 'api-key'
          ? Boolean(apiKeySecret) || persisted
          : Boolean(oauthSecret) || persisted;
      return [mode, present];
    }),
  ) as Partial<Record<LlmProviderAuthMode, boolean>>;
  const hasStoredSecret = hasStoredSecretByAuthMode[authMode] === true;
  const persistedModels = resolveProviderModels(rawId, provider.models ?? []);
  const requiresAccountCatalogCredential = catalogOwnership === 'app-managed'
    && builtinFallback.authMode === 'account'
    && builtinFallback.models.length === 0;
  // A dynamic account catalog is evidence owned by the connected identity. Once
  // that credential is gone, retaining its last catalog would present stale
  // models as currently discoverable even though the provider is unconfigured.
  const models = requiresAccountCatalogCredential && hasStoredSecretByAuthMode.account !== true
    ? []
    : persistedModels;
  const selectedAvailability = resolveSelectedAuthAvailability(rawId, authMode, builtinFallback);
  const canUseProvider = selectedAvailability.state !== 'unavailable' && hasStoredSecret;
  const configuredAuthMode = (builtinFallback.authModeOptions ?? [builtinFallback.authMode]).includes(provider.configuredAuthMode as LlmProviderAuthMode)
    ? provider.configuredAuthMode
    : provider.status === 'verified' || provider.isConfigured === true
      ? authMode
      : undefined;
  const status = pickProviderStatus(
    configuredAuthMode && configuredAuthMode !== authMode
      ? { ...provider, status: 'unconfigured', isConfigured: false }
      : provider,
    {
      ...builtinFallback,
      status: selectedAvailability.state === 'unavailable' ? 'unavailable' : 'unconfigured',
    },
    canUseProvider,
    models,
  );
  const hasEnabledModels = models.some((model) => model.enabled !== false);
  const enabled = status === 'verified' && hasEnabledModels;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;

  return {
    id: rawId,
    activeAccountId,
    authAccountIds,
    protocol,
    authMode,
    authModeOptions: builtinFallback.authModeOptions,
    authModeAvailability: builtinFallback.authModeAvailability,
    hasStoredSecretByAuthMode,
    configuredAuthMode,
    lifecycleStatus: builtinFallback.lifecycleStatus,
    providerAvailability: { ...builtinFallback.providerAvailability },
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode }),
    catalogOwnership,
    label,
    enabled,
    apiKey: '',
    secretRef,
    hasStoredSecret,
    baseUrl: (() => {
      const protocolDefault = resolveBuiltinProtocolBaseUrl(rawId, protocol);
      if (definition?.baseUrlEditable) {
        return typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
          ? provider.baseUrl.trim()
          : protocolDefault ?? definition.baseUrl;
      }
      if (definition?.protocolEditable && definition.protocolBaseUrls) {
        return protocolDefault ?? definition.baseUrl;
      }
      return definition?.baseUrl;
    })(),
    baseUrlEditable: definition?.baseUrlEditable,
    protocolEditable: definition?.protocolEditable,
    protocolOptions: getProviderPresetProtocolOptions(rawId),
    protocolBaseUrls: getProviderPresetProtocolBaseUrls(rawId),
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
    unavailableReason: selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined,
    isConfigured: status === 'verified' && hasEnabledModels && enabled,
    capabilities: definition?.capabilities ? [...definition.capabilities] : undefined,
  };
}

function normalizeUserProviders(
  providers: unknown,
  workspaceRoot: string,
  options: ProviderSanitizeOptions = {},
): LlmProviderEntry[] {
  const persistedProviders = new Map<string, LlmProviderEntry>();

  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const provider = sanitizeUserProvider(entry as Partial<LlmProviderEntry>, workspaceRoot, options);
    if (!provider || persistedProviders.has(provider.id)) {
      continue;
    }

    persistedProviders.set(provider.id, provider);
  }

  return createProviderEntriesFromPresets()
    .map((catalogProvider) => sanitizeUserProvider(
      persistedProviders.get(catalogProvider.id) ?? catalogProvider,
      workspaceRoot,
      options,
    ))
    .filter((provider): provider is LlmProviderEntry => provider !== null);
}

function hydrateProviderSecrets(
  providers: LlmProviderEntry[],
  workspaceRoot: string,
): LlmProviderEntry[] {
  return providers.map((provider) => {
    const apiKeySecret = getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
    const oauthSecret = secretStorageService.getSecret(
      getProviderAccountSecretRef(provider.id, provider.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
    const hasStoredSecretByAuthMode = Object.fromEntries(
      (provider.authModeOptions ?? [provider.authMode]).map((mode) => [
        mode,
        mode === 'local' || mode === 'environment'
          ? true
          : mode === 'api-key'
            ? Boolean(apiKeySecret)
            : Boolean(oauthSecret),
      ]),
    ) as Partial<Record<LlmProviderAuthMode, boolean>>;
    const hasStoredSecret = hasStoredSecretByAuthMode[provider.authMode] === true;
    const canUseProvider = hasStoredSecret && provider.authModeAvailability?.[provider.authMode]?.state !== 'unavailable';
    const hasEnabledModels = provider.models.some((model) => model.enabled !== false);
    const status = provider.status === 'unavailable'
      ? 'unavailable'
      : provider.status === 'verified'
        && provider.configuredAuthMode === provider.authMode
        && canUseProvider
        && hasEnabledModels
        ? 'verified'
        : provider.status === 'failed'
          ? 'failed'
          : 'unconfigured';
    const isConfigured = status === 'verified' && hasEnabledModels;

    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: '',
      hasStoredSecret,
      hasStoredSecretByAuthMode,
      enabled: isConfigured,
      status,
      isConfigured,
    };
  });
}

function normalizeUserRoutes(
  routes: unknown,
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

    // Preserve the explicit route. EffectiveCatalog resolves proven aliases and reports
    // MODEL_UNAVAILABLE without mutating user settings or silently substituting a model.
  }

  return Array.from(routeMap.values());
}

export class SettingsService {
  private initialized = false;
  private readonly agentDefinitionRevisions = new Map<string, number>();

  initialize(): AppSettings {
    const runtimePaths = appPathService.initializeRuntime();
    executionProfileService.ensureScaffold();

    const rawPersisted = readJsonFile<PersistedSettingsPayload>(runtimePaths.settingsPath);
    const rebuildResult = this.rebuildPersistedSettings(rawPersisted, runtimePaths.userRdxRoot);
    this.persistHardRebuild(runtimePaths, rawPersisted, rebuildResult);

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
    const fallback = createDefaultPersistedSettings();
    const candidate = raw ?? fallback;
    const requiresCredentialMigration = candidate.schemaVersion !== SETTINGS_SCHEMA_VERSION;
    const fixes: string[] = [];
    const warnings: string[] = [];
    const secretRefsToDelete = new Set<string>();
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
      const rawId = incomingId;
      if (!rawId) {
        fixes.push('Removed provider with empty id');
        continue;
      }
      if (!isBuiltinProviderId(rawId)) {
        fixes.push(`Removed non-catalog provider ${rawId}`);
        continue;
      }

      const builtin = createProviderEntryFromPreset(rawId);
      const authMode = resolveProviderAuthMode(entry, builtin);
      const authAccountIds = sanitizeAuthAccountIds(entry, authMode);
      const unkeyedApiKeyRef = secretStorageService.createProviderSecretRef(rawId);
      const unkeyedOAuthRef = secretStorageService.createProviderOAuthSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === 'string' && entry.secretRef.trim()
        ? entry.secretRef.trim()
        : undefined;
      let secretRef = incomingSecretRef || unkeyedApiKeyRef;
      if (requiresCredentialMigration && entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }

      if (requiresCredentialMigration && builtin.authModeOptions?.includes('account')) {
        const unkeyedBundle = secretStorageService.getSecret(unkeyedOAuthRef, workspaceRoot);
        const hasUnkeyedBundle = secretStorageService.hasSecretRecord(unkeyedOAuthRef, workspaceRoot);
        authAccountIds.account = authAccountIds.account
          ?? (authMode === 'account' ? entry.activeAccountId : undefined)
          ?? extractOAuthBundleAccountId(unkeyedBundle)
          ?? (hasUnkeyedBundle ? createLocalAccountId() : undefined);
        if (authAccountIds.account) {
          const accountRef = secretStorageService.createProviderAccountSecretRef(
            rawId,
            authAccountIds.account,
            'oauth',
          );
          if (secretStorageService.copySecret(unkeyedOAuthRef, accountRef, workspaceRoot)) {
            secretRefsToDelete.add(unkeyedOAuthRef);
            fixes.push(`Migrated OAuth secret to account key for ${rawId}`);
          }
        }
      }
      if (requiresCredentialMigration && builtin.authModeOptions?.includes('api-key')) {
        const hasExistingSecret = secretStorageService.hasSecretRecord(secretRef, workspaceRoot);
        authAccountIds['api-key'] = authAccountIds['api-key']
          ?? (authMode === 'api-key' ? entry.activeAccountId : undefined)
          ?? (hasExistingSecret ? createLocalAccountId() : undefined);
        if (authAccountIds['api-key']) {
          const accountRef = secretStorageService.createProviderAccountSecretRef(
            rawId,
            authAccountIds['api-key'],
            'api-key',
          );
          if (secretStorageService.copySecret(secretRef, accountRef, workspaceRoot)) {
            secretRefsToDelete.add(secretRef);
            fixes.push(`Migrated API key secret to account key for ${rawId}`);
          }
          secretRef = accountRef;
        }
      }

      const sanitized = sanitizeUserProvider({
        ...entry,
        authMode,
        activeAccountId: authAccountIds[authMode],
        authAccountIds,
        secretRef,
      }, workspaceRoot, { credentialView: 'storage-metadata' });
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

    const catalogProviders = normalizeUserProviders(nextProviders, workspaceRoot, {
      credentialView: 'storage-metadata',
    });
    const normalizedRoutes = normalizeUserRoutes(rawRoutes);
    const nextRoutes = normalizedRoutes;
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map((entry) => {
      if (entry && typeof entry === 'object') {
        const providerId = (entry as Partial<LlmAgentRoute>).providerId;
        const incomingProviderId = typeof providerId === 'string' ? providerId.trim() : '';
        const normalizedProviderId = incomingProviderId;
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
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? 'dark'),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? 'zh-CN'),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? 'medium'),
        composerMarkdown: typeof candidate.appearance?.composerMarkdown === 'boolean'
          ? candidate.appearance.composerMarkdown
          : (fallback.appearance?.composerMarkdown ?? DEFAULT_APPEARANCE.composerMarkdown),
        usePointerCursors: typeof candidate.appearance?.usePointerCursors === 'boolean'
          ? candidate.appearance.usePointerCursors
          : (fallback.appearance?.usePointerCursors ?? DEFAULT_APPEARANCE.usePointerCursors),
        contextBreakdownExpanded: typeof candidate.appearance?.contextBreakdownExpanded === 'boolean'
          ? candidate.appearance.contextBreakdownExpanded
          : (fallback.appearance?.contextBreakdownExpanded ?? DEFAULT_APPEARANCE.contextBreakdownExpanded),
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
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: '' })),
        agentRoutes: nextRoutes,
      },
    };

    return {
      settings: nextSettings,
      changed: JSON.stringify(candidate) !== JSON.stringify(nextSettings),
      fixes,
      warnings,
      secretRefsToDelete: [...secretRefsToDelete],
    };
  }

  private normalizePersistedSettings(
    raw: PersistedSettingsPayload | null,
    workspaceRoot: string,
    options: ProviderSanitizeOptions = {},
  ): NormalizedPersistedSettings {
    const fallback = createDefaultPersistedSettings();
    const candidate = raw ?? fallback;
    const nextProviders = normalizeUserProviders(candidate.llm?.providers, workspaceRoot, options).map((provider) => ({
      ...provider,
      apiKey: '',
    }));
    const nextRoutes = normalizeUserRoutes(candidate.llm?.agentRoutes);

    return {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? 'dark'),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? 'zh-CN'),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? 'medium'),
        composerMarkdown: typeof candidate.appearance?.composerMarkdown === 'boolean'
          ? candidate.appearance.composerMarkdown
          : (fallback.appearance?.composerMarkdown ?? DEFAULT_APPEARANCE.composerMarkdown),
        usePointerCursors: typeof candidate.appearance?.usePointerCursors === 'boolean'
          ? candidate.appearance.usePointerCursors
          : (fallback.appearance?.usePointerCursors ?? DEFAULT_APPEARANCE.usePointerCursors),
        contextBreakdownExpanded: typeof candidate.appearance?.contextBreakdownExpanded === 'boolean'
          ? candidate.appearance.contextBreakdownExpanded
          : (fallback.appearance?.contextBreakdownExpanded ?? DEFAULT_APPEARANCE.contextBreakdownExpanded),
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
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes,
      },
    };
  }

  private persistHardRebuild(
    paths: AppRuntimePaths,
    _previous: PersistedSettingsPayload | null,
    result: HardRebuildResult,
  ): void {
    this.writeSettings(result.settings);
    this.deleteSecretsAfterCommit(result.secretRefsToDelete, paths.userRdxRoot);
  }

  private toRuntimeSettings(
    persisted: PersistedSettingsPayload,
    runtimePaths?: Partial<AppRuntimePaths>,
  ): AppSettings {
    const workspaceRoot = appPathService.getUserRdxRoot();
    const normalized = this.normalizePersistedSettings(persisted, workspaceRoot);
    const hydratedProviders = hydrateProviderSecrets(normalized.llm.providers, workspaceRoot);
    const paths = appPathService.getRuntimePaths();
    const resourceCatalog: RuntimeResourceCatalog = executionProfileService.normalizeResourceCatalog({
      availableSkills: [],
      availableMcpServers: [],
      diagnostics: [],
    });

    const settings: AppSettings = {
      ...createDefaultRuntimeSettings(),
      appearance: normalized.appearance,
      layout: normalized.layout,
      profile: normalized.profile,
      tooling: normalized.tooling,
      agentRuntime: normalized.agentRuntime,
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes()),
      },
      agents: agentManifestService.getSettings(paths, hydratedProviders, normalized.llm?.agentRoutes ?? createEmptyAgentRoutes()),
      resourceCatalog,
      paths: {
        ...paths,
        ...(runtimePaths ?? {}),
      },
    };

    settings.resourceCatalog.diagnostics = executionProfileService.getDiagnostics(settings);
    return settings;
  }

  private writeSettings(settings: PersistedSettingsPayload): void {
    const filePath = appPathService.getRuntimePaths().settingsPath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      fs.renameSync(temporaryPath, filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }

  private deleteSecretsAfterCommit(secretRefs: Iterable<string>, workspaceRoot: string): void {
    for (const secretRef of new Set(secretRefs)) {
      secretStorageService.deleteSecret(secretRef, workspaceRoot);
    }
  }

  getAll(runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();
    const paths = appPathService.getRuntimePaths();
    const persisted = readJsonFile<PersistedSettingsPayload>(paths.settingsPath)
      ?? createDefaultPersistedSettings();
    return this.toRuntimeSettings(persisted, runtimePaths);
  }

  getProviderSecret(providerId: string, workspaceRoot = appPathService.getUserRdxRoot()): string {
    this.ensureInitialized();

    const persisted = this.normalizePersistedSettings(
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

  getProviderOAuthSecret(providerId: string, workspaceRoot = appPathService.getUserRdxRoot()): string {
    this.ensureInitialized();
    const provider = this.getAll().llm.providers.find((entry) => entry.id === providerId);
    return secretStorageService.getSecret(
      getProviderAccountSecretRef(providerId, provider?.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
  }

  setAll(patch: AppSettingsPatch, runtimePaths?: Partial<AppRuntimePaths>): AppSettings {
    this.ensureInitialized();

    const nextPaths = appPathService.initializeRuntime();
    executionProfileService.ensureScaffold();

    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(nextPaths.settingsPath) ?? createDefaultPersistedSettings(),
      nextPaths.userRdxRoot,
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
        const previousSecret = getResolvedProviderSecret(provider.id, secretRef, nextPaths.userRdxRoot);
        if (!authAccountIds['api-key'] || previousSecret !== apiKey) {
          const previousRef = secretRef;
          authAccountIds['api-key'] = createLocalAccountId();
          secretRef = getProviderAccountSecretRef(provider.id, authAccountIds['api-key'], 'api-key');
          if (previousRef && previousRef !== secretRef) {
            secretRefsToDelete.add(previousRef);
          }
        }
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.userRdxRoot);
      } else if (provider.authMode === 'api-key' && provider.hasStoredSecretByAuthMode?.['api-key'] !== true && !provider.hasStoredSecret) {
        if (secretRef) secretRefsToDelete.add(secretRef);
        delete authAccountIds['api-key'];
      }
      return sanitizeUserProvider({
        ...provider,
        activeAccountId: authAccountIds[provider.authMode],
        authAccountIds,
        secretRef,
      }, nextPaths.userRdxRoot, { credentialView: providerCredentialView });
    }).filter((provider): provider is LlmProviderEntry => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.userRdxRoot, {
      credentialView: providerCredentialView,
    });
    const currentRoutes = normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? []);
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
      ? agentManifestService.routesFromDefinitions(currentRoutes, patch.agents.definitions)
      : currentRoutes;

    const nextPersisted: PersistedSettingsPayload = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
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
        composerMarkdown: typeof (patch.appearance?.composerMarkdown ?? currentPersisted.appearance?.composerMarkdown) === 'boolean'
          ? Boolean(patch.appearance?.composerMarkdown ?? currentPersisted.appearance?.composerMarkdown)
          : DEFAULT_APPEARANCE.composerMarkdown,
        usePointerCursors: typeof (patch.appearance?.usePointerCursors ?? currentPersisted.appearance?.usePointerCursors) === 'boolean'
          ? Boolean(patch.appearance?.usePointerCursors ?? currentPersisted.appearance?.usePointerCursors)
          : DEFAULT_APPEARANCE.usePointerCursors,
        contextBreakdownExpanded: typeof (patch.appearance?.contextBreakdownExpanded ?? currentPersisted.appearance?.contextBreakdownExpanded) === 'boolean'
          ? Boolean(patch.appearance?.contextBreakdownExpanded ?? currentPersisted.appearance?.contextBreakdownExpanded)
          : DEFAULT_APPEARANCE.contextBreakdownExpanded,
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
        agentRoutes: normalizeUserRoutes(manifestRoutes),
      },
    };

    this.writeSettings(nextPersisted);
    this.deleteSecretsAfterCommit(secretRefsToDelete, nextPaths.userRdxRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
  }

  saveAgentDefinition(request: AgentDefinitionSaveRequest): AgentDefinitionSaveResult {
    this.ensureInitialized();
    const agentId = request.draft.id.trim();
    if (!isSafeAgentProfileId(agentId)) {
      throw new Error(`Invalid agent profile id: ${agentId || '<empty>'}`);
    }
    if (!Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      throw new Error('clientRevision must be a positive safe integer.');
    }

    const paths = appPathService.getRuntimePaths();
    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(paths.settingsPath) ?? createDefaultPersistedSettings(),
      paths.userRdxRoot,
      { credentialView: 'storage-metadata' },
    );
    const currentRoutes = normalizeUserRoutes(currentPersisted.llm.agentRoutes);
    const currentDefinitions = agentManifestService.getSettings(
      paths,
      currentPersisted.llm.providers,
      currentRoutes,
    ).definitions;
    const currentDefinition = currentDefinitions.find((definition) => (
      definition.id === agentId || definition.fileName === request.draft.fileName
    )) ?? null;
    const latestRevision = this.agentDefinitionRevisions.get(agentId) ?? 0;
    if (request.clientRevision <= latestRevision) {
      return {
        clientRevision: request.clientRevision,
        applied: false,
        definition: currentDefinition,
        route: currentRoutes.find((route) => route.agentId === agentId) ?? null,
      };
    }

    let definition: AgentDefinitionSaveResult['definition'] = null;
    try {
      definition = agentManifestService.saveDefinition(paths, request.draft);
      const route = definition ? agentManifestService.routeFromDefinition(definition) : null;
      const replacedAgentIds = new Set([agentId, currentDefinition?.id].filter(Boolean));
      const nextRoutes = normalizeUserRoutes([
        ...currentRoutes.filter((entry) => !replacedAgentIds.has(entry.agentId)),
        ...(route ? [route] : []),
      ]);
      this.writeSettings({
        ...currentPersisted,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        llm: {
          providers: currentPersisted.llm.providers,
          agentRoutes: nextRoutes,
        },
      });
      this.agentDefinitionRevisions.set(agentId, request.clientRevision);
      return {
        clientRevision: request.clientRevision,
        applied: true,
        definition,
        route,
      };
    } catch (error) {
      try {
        agentManifestService.saveDefinition(paths, { ...request.draft, delete: true });
        if (currentDefinition) {
          const {
            filePath: _filePath,
            builtin: _builtin,
            updatedAt: _updatedAt,
            ...previousDraft
          } = currentDefinition;
          agentManifestService.saveDefinition(paths, previousDraft as AgentManifestDraft);
        }
      } catch {
        // Preserve the original transaction failure; repository/runtime checks
        // will surface any rollback failure through the missing manifest.
      }
      throw error;
    }
  }

  saveProviderConnection(
    providerId: LlmProviderId,
    apiKey: string,
    models: LlmProviderModel[],
    baseUrl = '',
    protocolDraft?: unknown,
    authModeDraft?: LlmProviderAuthMode,
    modelPreferences?: LlmProviderModelPreference[],
  ): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const authMode = authModeDraft && provider.authModeOptions?.includes(authModeDraft)
      ? authModeDraft
      : provider.authMode;
    if (authMode === 'account') {
      throw new Error(`Provider ${providerId} account mode must use its login flow.`);
    }
    const authAvailability = resolveSelectedAuthAvailability(provider.id, authMode, createProviderEntryFromPreset(provider.id));
    if (authAvailability.state === 'unavailable') {
      throw new Error(authAvailability.reason ?? `Provider ${providerId} ${authMode} authentication is unavailable.`);
    }
    const discoveredModels = applyModelPreferences(
      resolveProviderModels(provider.id, models),
      modelPreferences ?? provider.models,
    );
    if (discoveredModels.length === 0) {
      throw new Error('该 Provider 暂未返回可用模型');
    }

    const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);
    const protocol = normalizeProviderProtocol({ id: provider.id, protocol: protocolDraft ?? provider.protocol });
    const timestamp = nowIso();
    const protocolDefault = resolveBuiltinProtocolBaseUrl(provider.id, protocol);
    const nextBaseUrl = provider.baseUrlEditable
      ? (baseUrl.trim() || protocolDefault || provider.baseUrl)
      : (protocolDefault || provider.baseUrl);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode,
      activeAccountId: provider.authAccountIds?.[authMode],
      apiKey: apiKey.trim(),
      protocol,
      enabled: hasEnabledModels,
      hasStoredSecret: authMode === 'api-key'
        ? Boolean(apiKey.trim() || provider.hasStoredSecretByAuthMode?.['api-key'])
        : authMode === 'local' || authMode === 'environment',
      hasStoredSecretByAuthMode: {
        ...(provider.hasStoredSecretByAuthMode ?? {}),
        [authMode]: authMode === 'api-key'
          ? Boolean(apiKey.trim() || provider.hasStoredSecretByAuthMode?.['api-key'])
          : true,
      },
      configuredAuthMode: authMode,
      baseUrl: nextBaseUrl,
      protocolOptions: getProviderPresetProtocolOptions(provider.id),
      protocolBaseUrls: getProviderPresetProtocolBaseUrls(provider.id),
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: undefined,
      planLabel: undefined,
      oauthExpiresAt: undefined,
      oauthRefreshAvailable: undefined,
      unavailableReason: undefined,
      isConfigured: hasEnabledModels,
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
    if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
      throw new Error(`Unknown account provider: ${providerId}`);
    }

    const discoveredModels = applyModelPreferences(resolveProviderModels(provider.id, models), provider.models);
    if (discoveredModels.length === 0) {
      throw new Error('Provider returned no usable models');
    }

    const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);

    const activeAccountId = extractOAuthBundleAccountId(secretPayload)
      ?? provider.authAccountIds?.account
      ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    const previousSecretRef = provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
      ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
      : undefined;
    secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);

    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode: 'account',
      activeAccountId,
      authAccountIds: { ...(provider.authAccountIds ?? {}), account: activeAccountId },
      enabled: hasEnabledModels,
      hasStoredSecret: true,
      hasStoredSecretByAuthMode: { ...(provider.hasStoredSecretByAuthMode ?? {}), account: true },
      configuredAuthMode: 'account',
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      unavailableReason: undefined,
      isConfigured: hasEnabledModels,
    };

    const nextSettings = this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
    this.deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], current.paths.userRdxRoot);
    return nextSettings;
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
      throw new Error(`Unknown account provider: ${providerId}`);
    }
    const activeAccountId = extractOAuthBundleAccountId(secretPayload)
      ?? provider.authAccountIds?.account
      ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    const previousSecretRef = provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
      ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
      : undefined;
    secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode: 'account',
      activeAccountId,
      authAccountIds: { ...(provider.authAccountIds ?? {}), account: activeAccountId },
      hasStoredSecret: true,
      hasStoredSecretByAuthMode: { ...(provider.hasStoredSecretByAuthMode ?? {}), account: true },
      configuredAuthMode: 'account',
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
    };
    const nextSettings = this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
    this.deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], current.paths.userRdxRoot);
    return nextSettings;
  }

  markProviderAccountRefreshFailure(providerId: LlmProviderId, message: string): AppSettings {
    const current = this.getAll();
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((provider) => provider.id === providerId
          ? { ...provider, enabled: false, status: 'failed', isConfigured: false, lastError: message }
          : provider),
        agentRoutes: current.llm.agentRoutes,
      },
    });
  }

  disconnectProvider(providerId: LlmProviderId, authModeDraft?: LlmProviderAuthMode): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const authMode = authModeDraft && provider.authModeOptions?.includes(authModeDraft)
      ? authModeDraft
      : provider.authMode;
    const secretRefToDelete = authMode === 'api-key'
      ? provider.secretRef
      : authMode === 'account'
        ? getProviderAccountSecretRef(provider.id, provider.authAccountIds?.account, 'oauth')
        : undefined;
    const authAccountIds = { ...(provider.authAccountIds ?? {}) };
    const hasStoredSecretByAuthMode = { ...(provider.hasStoredSecretByAuthMode ?? {}) };
    if (authMode === 'api-key') {
      delete authAccountIds['api-key'];
      hasStoredSecretByAuthMode['api-key'] = false;
    } else if (authMode === 'account') {
      delete authAccountIds.account;
      hasStoredSecretByAuthMode.account = false;
    }

    if (authMode !== provider.authMode) {
      const nextSettings = this.setAll({
        llm: {
          providers: current.llm.providers.map((entry) => entry.id === providerId
            ? { ...provider, authAccountIds, hasStoredSecretByAuthMode }
            : entry),
          agentRoutes: current.llm.agentRoutes,
        },
      });
      this.deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], current.paths.userRdxRoot);
      return nextSettings;
    }

    const fallback = createProviderEntryFromPreset(provider.id);
    const selectedAvailability = resolveSelectedAuthAvailability(provider.id, provider.authMode, fallback);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      activeAccountId: undefined,
      authAccountIds,
      apiKey: '',
      hasStoredSecret: hasStoredSecretByAuthMode[provider.authMode] === true,
      hasStoredSecretByAuthMode,
      configuredAuthMode: undefined,
      models: fallback.models,
      enabled: false,
      status: selectedAvailability.state === 'unavailable' ? 'unavailable' : 'unconfigured',
      lastError: undefined,
      accountLabel: undefined,
      planLabel: undefined,
      oauthExpiresAt: undefined,
      oauthRefreshAvailable: undefined,
      unavailableReason: selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined,
      isConfigured: false,
    };

    const nextSettings = this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
    this.deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], current.paths.userRdxRoot);
    return nextSettings;
  }

  getLlmConfig(): LLMConfig {
    const settings = this.getAll();
    const providers: LLMProviderConfig[] = settings.llm.providers
      .filter((provider) => provider.enabled && provider.isConfigured && provider.status === 'verified')
      .map((provider) => {
        const accountCredential = provider.authMode === 'account'
          ? resolveAccountRuntimeCredential(provider, settings.paths.userRdxRoot)
          : { apiKey: '', baseUrl: undefined };
        return {
          id: provider.id,
          protocol: provider.protocol,
          label: provider.label,
          enabled: provider.enabled,
          apiKey: provider.authMode === 'api-key'
            ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.paths.userRdxRoot)
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
    return appPathService.getRuntimePaths().settingsPath;
  }
}

export const settingsService = new SettingsService();
