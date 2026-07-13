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
  createProviderEntryFromPreset,
  createProviderEntriesFromPresets,
  getProviderPresetCatalogOwnership,
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
import { resolveProviderModelAvailability } from './LlmRouteCompatibility';

type PersistedLlmProviderEntry = Partial<LlmProviderEntry>;

interface PersistedSettingsPayload {
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

type ProviderCredentialPolicy = 'runtime' | 'persisted';

interface ProviderSanitizeOptions {
  credentialPolicy?: ProviderCredentialPolicy;
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
): string {
  return accountId
    ? secretStorageService.createProviderAccountSecretRef(providerId, accountId, kind)
    : kind === 'oauth'
      ? secretStorageService.createProviderOAuthSecretRef(providerId)
      : secretStorageService.createProviderSecretRef(providerId);
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
    const availability = candidate.availability === 'available'
      || candidate.availability === 'unavailable'
      || candidate.availability === 'unknown'
      ? candidate.availability
      : undefined;

    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
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
    availability: persistedById.get(model.id)?.availability ?? model.availability,
    availabilityReason: persistedById.get(model.id)?.availabilityReason,
  }));
}

function resolveProviderModels(providerId: string, persistedModels: unknown): LlmProviderModel[] {
  const sanitized = sanitizeModels(persistedModels);
  if (getProviderPresetCatalogOwnership(providerId) !== 'app-managed') {
    return sanitized;
  }
  // Volc Coding Plan discovery is account-specific. Once a verified subset has
  // been persisted, do not re-expand it to the entire application catalog.
  if (providerId === 'volcengine-coding-plan' && sanitized.length > 0) {
    return sanitized;
  }
  const catalogModels = getProviderSeedModels(providerId);
  return catalogModels.length > 0 ? applyModelEnabledState(catalogModels, sanitized) : sanitized;
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
  const activeAccountId = typeof provider.activeAccountId === 'string' && provider.activeAccountId.trim()
    ? provider.activeAccountId.trim()
    : undefined;
  const incomingSecretRef = typeof provider.secretRef === 'string' && provider.secretRef.trim()
    ? provider.secretRef.trim()
    : undefined;
  const secretRef = incomingSecretRef || secretStorageService.createProviderSecretRef(rawId);
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const catalogOwnership = getProviderPresetCatalogOwnership(rawId);
  const models = resolveProviderModels(rawId, provider.models ?? []);
  const oauthSecretRef = getProviderAccountSecretRef(rawId, activeAccountId, 'oauth');
  const resolvedSecret = builtinFallback.authMode === 'api-key'
    ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot)
    : builtinFallback.authMode === 'account'
      ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot)
      : '';
  const preservePersistedCredentialState = options.credentialPolicy === 'persisted';
  const hasPersistedSecret = preservePersistedCredentialState && provider.hasStoredSecret === true;
  const hasStoredSecret = builtinFallback.hasStoredSecret || Boolean(resolvedSecret) || hasPersistedSecret;
  const canUseProvider = builtinFallback.status !== 'unavailable' && (builtinFallback.authMode === 'local' || builtinFallback.authMode === 'environment'
    ? true
    : Boolean(resolvedSecret) || hasPersistedSecret);
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const hasEnabledModels = models.some((model) => model.enabled !== false);
  const enabled = status === 'verified' && hasEnabledModels;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;

  return {
    id: rawId,
    activeAccountId,
    protocol,
    authMode: builtinFallback.authMode,
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode: builtinFallback.authMode }),
    catalogOwnership,
    modelDiscovery: builtinFallback.modelDiscovery,
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
    unavailableReason: definition?.unavailableReason,
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
    const resolvedSecret = provider.authMode === 'api-key'
      ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot)
      : provider.authMode === 'account'
        ? secretStorageService.getSecret(
            getProviderAccountSecretRef(provider.id, provider.activeAccountId, 'oauth'),
            workspaceRoot,
          )
        : '';
    const hasStoredSecret = provider.authMode === 'local' || provider.authMode === 'environment' || Boolean(resolvedSecret);
    const canUseProvider = provider.authMode === 'local' || provider.authMode === 'environment'
      ? true
      : provider.authMode === 'api-key'
        ? Boolean(resolvedSecret)
        : Boolean(resolvedSecret);
    const hasEnabledModels = provider.models.some((model) => model.enabled !== false);
    const status = provider.status === 'unavailable'
      ? 'unavailable'
      : provider.status === 'verified' && canUseProvider && hasEnabledModels
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
    if (provider) {
      const resolution = resolveProviderModelAvailability(provider, incoming.modelId);
      if (resolution.modelId && resolution.modelId !== incoming.modelId) {
        routeMap.set(agentId, { ...incoming, modelId: resolution.modelId });
      }
    }
    // Otherwise preserve the explicit route. Runtime reports MODEL_UNAVAILABLE
    // with same-provider recommendations instead of clearing/substituting it.
  }

  return Array.from(routeMap.values());
}

export class SettingsService {
  private initialized = false;

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
      let activeAccountId = typeof entry.activeAccountId === 'string' && entry.activeAccountId.trim()
        ? entry.activeAccountId.trim()
        : undefined;
      const legacyApiKeyRef = secretStorageService.createProviderSecretRef(rawId);
      const legacyOAuthRef = secretStorageService.createProviderOAuthSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === 'string' && entry.secretRef.trim()
        ? entry.secretRef.trim()
        : undefined;
      let secretRef = incomingSecretRef || legacyApiKeyRef;
      if (entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }

      if (builtin.authMode === 'account') {
        const legacyBundle = secretStorageService.getSecret(legacyOAuthRef, workspaceRoot);
        activeAccountId = activeAccountId ?? extractOAuthBundleAccountId(legacyBundle) ?? (legacyBundle ? createLocalAccountId() : undefined);
        if (activeAccountId) {
          const accountRef = getProviderAccountSecretRef(rawId, activeAccountId, 'oauth');
          if (secretStorageService.moveSecret(legacyOAuthRef, accountRef, workspaceRoot)) {
            fixes.push(`Migrated OAuth secret to account key for ${rawId}`);
          }
        }
      } else if (builtin.authMode === 'api-key') {
        const existingSecret = secretStorageService.getSecret(secretRef, workspaceRoot);
        activeAccountId = activeAccountId ?? (existingSecret ? createLocalAccountId() : undefined);
        if (activeAccountId) {
          const accountRef = getProviderAccountSecretRef(rawId, activeAccountId, 'api-key');
          if (secretStorageService.moveSecret(secretRef, accountRef, workspaceRoot)) {
            fixes.push(`Migrated API key secret to account key for ${rawId}`);
          }
          secretRef = accountRef;
        }
      }

      const sanitized = sanitizeUserProvider({ ...entry, activeAccountId, secretRef }, workspaceRoot, {
        credentialPolicy: 'persisted',
      });
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
      credentialPolicy: 'persisted',
    });
    const normalizedRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
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
    const nextRoutes = normalizeUserRoutes(candidate.llm?.agentRoutes, nextProviders);

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
    _paths: AppRuntimePaths,
    _previous: PersistedSettingsPayload | null,
    result: HardRebuildResult,
  ): void {
    this.writeSettings(result.settings);
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
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders),
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
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
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
    if (!provider || provider.authMode !== 'api-key') {
      return '';
    }

    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }

  getProviderOAuthSecret(providerId: string, workspaceRoot = appPathService.getUserRdxRoot()): string {
    this.ensureInitialized();
    const provider = this.getAll().llm.providers.find((entry) => entry.id === providerId);
    return secretStorageService.getSecret(
      getProviderAccountSecretRef(providerId, provider?.activeAccountId, 'oauth'),
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
      { credentialPolicy: 'persisted' },
    );

    const hasProviderPatch = Boolean(patch.llm?.providers);
    const providerCredentialPolicy: ProviderCredentialPolicy = hasProviderPatch ? 'runtime' : 'persisted';
    const providerDrafts = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      let activeAccountId = provider.activeAccountId;
      let secretRef = provider.secretRef || getProviderAccountSecretRef(provider.id, activeAccountId, 'api-key');
      const apiKey = provider.apiKey?.trim() ?? '';
      if (provider.authMode === 'api-key' && apiKey) {
        const previousSecret = getResolvedProviderSecret(provider.id, secretRef, nextPaths.userRdxRoot);
        if (!activeAccountId || previousSecret !== apiKey) {
          const previousRef = secretRef;
          activeAccountId = createLocalAccountId();
          secretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'api-key');
          if (previousRef !== secretRef) {
            secretStorageService.moveSecret(previousRef, secretRef, nextPaths.userRdxRoot);
          }
        }
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.userRdxRoot);
      } else if (provider.authMode === 'api-key' && !provider.hasStoredSecret) {
        secretStorageService.deleteSecret(secretRef, nextPaths.userRdxRoot);
        activeAccountId = undefined;
      }
      return sanitizeUserProvider({
        ...provider,
        activeAccountId,
        secretRef,
      }, nextPaths.userRdxRoot, { credentialPolicy: providerCredentialPolicy });
    }).filter((provider): provider is LlmProviderEntry => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.userRdxRoot, {
      credentialPolicy: providerCredentialPolicy,
    });
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
        agentRoutes: normalizeUserRoutes(manifestRoutes, nextProviders),
      },
    };

    this.writeSettings(nextPersisted);
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

    const discoveredModels = resolveProviderModels(provider.id, models);
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
      apiKey: apiKey.trim(),
      protocol,
      enabled: hasEnabledModels,
      hasStoredSecret: provider.authMode === 'api-key'
        ? Boolean(apiKey.trim() || provider.hasStoredSecret)
        : provider.authMode === 'local' || provider.authMode === 'environment' || provider.hasStoredSecret,
      baseUrl: nextBaseUrl,
      protocolOptions: getProviderPresetProtocolOptions(provider.id),
      protocolBaseUrls: getProviderPresetProtocolBaseUrls(provider.id),
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
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
    if (!provider || !isBuiltinProviderId(provider.id) || provider.authMode !== 'account') {
      throw new Error(`Unknown account provider: ${providerId}`);
    }

    const discoveredModels = resolveProviderModels(provider.id, models);
    if (discoveredModels.length === 0) {
      throw new Error('Provider returned no usable models');
    }

    const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);

    const activeAccountId = extractOAuthBundleAccountId(secretPayload)
      ?? provider.activeAccountId
      ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    if (provider.activeAccountId && provider.activeAccountId !== activeAccountId) {
      secretStorageService.moveSecret(
        getProviderAccountSecretRef(provider.id, provider.activeAccountId, 'oauth'),
        nextSecretRef,
        current.paths.userRdxRoot,
      );
    }
    secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);

    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      activeAccountId,
      enabled: hasEnabledModels,
      hasStoredSecret: true,
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      isConfigured: hasEnabledModels,
    };

    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || provider.authMode !== 'account') {
      throw new Error(`Unknown account provider: ${providerId}`);
    }
    const activeAccountId = extractOAuthBundleAccountId(secretPayload)
      ?? provider.activeAccountId
      ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    if (provider.activeAccountId && provider.activeAccountId !== activeAccountId) {
      secretStorageService.moveSecret(
        getProviderAccountSecretRef(provider.id, provider.activeAccountId, 'oauth'),
        nextSecretRef,
        current.paths.userRdxRoot,
      );
    }
    secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      activeAccountId,
      hasStoredSecret: true,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes,
      },
    });
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

  disconnectProvider(providerId: LlmProviderId): AppSettings {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (provider.authMode === 'api-key') {
      secretStorageService.deleteSecret(provider.secretRef, current.paths.userRdxRoot);
    } else if (provider.authMode === 'account') {
      secretStorageService.deleteSecret(
        getProviderAccountSecretRef(provider.id, provider.activeAccountId, 'oauth'),
        current.paths.userRdxRoot,
      );
    }

    const fallback = createProviderEntryFromPreset(provider.id);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      activeAccountId: undefined,
      apiKey: '',
      hasStoredSecret: fallback.hasStoredSecret,
      models: fallback.models,
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
    return appPathService.getRuntimePaths().settingsPath;
  }
}

export const settingsService = new SettingsService();
