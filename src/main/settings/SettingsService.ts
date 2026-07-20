import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
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
  LlmProviderConnectionSchema,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
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
  AgentDefinitionCommitSnapshot,
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
  createProviderEntryFromCatalog,
  createProviderEntriesFromCatalog,
  getProviderAuthModeAvailability,
  getProviderCatalogModelSummaries,
  getProviderCatalogOwnership,
  getProviderDiscoveryAuthority,
  getProviderDefaultBaseUrl,
  getProviderModelSummaries,
  isBuiltinProviderId,
} from '../provider-catalog/ProviderCatalogRegistry';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';
import { executionProfileService } from './ExecutionProfileService';
import { providerCatalogService } from './ProviderCatalogService';
import { normalizeProviderCategory, normalizeProviderProtocol } from './providerCatalogNormalize';
import { secretStorageService } from './SecretStorageService';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { resolvePrimaryConnectionSecretFieldId } from './ProviderConnectionSchema';

type PersistedLlmProviderEntry = Partial<LlmProviderEntry>;

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hashProviderDefinition(provider: LlmProviderEntry): string {
  return createHash('sha256').update(stableSerialize({ ...provider, apiKey: '' }), 'utf8').digest('hex');
}

interface PersistedSettingsPayload {
  schemaVersion?: number;
  appearance?: Partial<UiPreferences>;
  layout?: Partial<LayoutPreferences>;
  profile?: Partial<ProfileSettings>;
  llm?: {
    providers?: PersistedLlmProviderEntry[];
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
  };
}

export const SETTINGS_SCHEMA_VERSION = 4;

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
  return getProviderAuthModeAvailability(providerId)[mode]
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
      accountId?: string;
      resourceUrl?: string;
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
    if (providerId === 'nous') {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? '',
        baseUrl: bundle.resourceUrl ?? 'https://inference-api.nousresearch.com/v1',
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
      preferredRouteOptionId: typeof candidate.preferredRouteOptionId === 'string'
        && candidate.preferredRouteOptionId.trim()
        ? candidate.preferredRouteOptionId.trim()
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
  return catalogModels.map((model) => {
    const persisted = persistedById.get(model.id);
    const manifestDenied = model.availability === 'unavailable';
    return {
      ...model,
      enabled: persisted?.enabled ?? true,
      defaultReasoningSelection: persisted?.defaultReasoningSelection,
      defaultBudgetTokens: persisted?.defaultBudgetTokens,
      preferredRouteOptionId: persisted?.preferredRouteOptionId,
      availability: manifestDenied ? 'unavailable' : persisted?.availability ?? model.availability,
      availabilityReason: manifestDenied ? model.availabilityReason : persisted?.availabilityReason,
    };
  });
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
      preferredRouteOptionId: typeof preference.preferredRouteOptionId === 'string'
        && preference.preferredRouteOptionId.trim()
        ? preference.preferredRouteOptionId.trim()
        : undefined,
    };
  });
}

function resolveProviderModels(providerId: string, persistedModels: unknown): LlmProviderModel[] {
  const sanitized = sanitizeModels(persistedModels);
  const ownership = getProviderCatalogOwnership(providerId);
  const authority = getProviderDiscoveryAuthority(providerId);
  const catalogMetadata = getProviderCatalogModelSummaries(providerId);
  const metadataById = new Map(catalogMetadata.map((metadata) => [metadata.modelId, metadata]));
  const catalogModels = getProviderModelSummaries(providerId);
  const catalogKeys = new Set(catalogMetadata.flatMap((metadata) => (
    [metadata.modelId, ...metadata.aliases].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const observedKeys = new Set(sanitized.flatMap((model) => (
    [model.id, ...(model.aliases ?? [])].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const visibleCatalogModels = catalogModels.filter((model) => {
    const metadata = metadataById.get(model.id);
    if (!metadata || metadata.presencePolicy === 'maintained') return true;
    return [metadata.modelId, ...metadata.aliases]
      .map(normalizeDiscoveredModelMatchKey)
      .some((key) => observedKeys.has(key));
  });
  const dynamicAllowed = ownership !== 'app-managed'
    && authority !== 'candidate-validation'
    && authority !== 'entitlement-overlay';
  const dynamicModels = dynamicAllowed
    ? sanitized.filter((model) => {
        if (!isAdmittedDiscoveredModel({ id: model.id })) return false;
        return ![model.id, ...(model.aliases ?? [])]
          .map(normalizeDiscoveredModelMatchKey)
          .some((key) => catalogKeys.has(key));
      })
    : [];
  return [
    ...applyModelEnabledState(visibleCatalogModels, sanitized),
    ...dynamicModels,
  ];
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

function cloneConnectionSchema(
  schema: LlmProviderConnectionSchema | undefined,
): LlmProviderConnectionSchema | undefined {
  return schema
    ? {
        ...schema,
        fields: schema.fields.map((field) => ({ ...field })),
        credentialAlternatives: schema.credentialAlternatives
          ?.map((alternative) => ({ ...alternative, fieldIds: [...alternative.fieldIds] })),
        headerMappings: schema.headerMappings?.map((mapping) => ({ ...mapping })),
      }
    : undefined;
}

function sanitizeConnectionValues(
  schema: LlmProviderConnectionSchema | undefined,
  values: Record<string, string> | undefined,
): Record<string, string> {
  const nonSecretFieldIds = new Set(
    schema?.fields.filter((field) => field.kind !== 'secret').map((field) => field.id) ?? [],
  );
  return Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([fieldId, value]) => {
      if (!nonSecretFieldIds.has(fieldId) || typeof value !== 'string' || !value.trim()) {
        return [];
      }
      return [[fieldId, value.trim()]];
    }),
  );
}

function sanitizeConnectionSecretRefs(
  providerId: string,
  accountId: string | undefined,
  schema: LlmProviderConnectionSchema | undefined,
  refs: Record<string, string> | undefined,
): Record<string, string> {
  if (!accountId) {
    return {};
  }
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(schema);
  const secretFieldIds = new Set(
    schema?.fields
      .filter((field) => field.kind === 'secret' && field.id !== primarySecretFieldId)
      .map((field) => field.id) ?? [],
  );
  return Object.fromEntries(
    Object.entries(refs ?? {}).flatMap(([fieldId, secretRef]) => {
      if (!secretFieldIds.has(fieldId) || typeof secretRef !== 'string') {
        return [];
      }
      const expectedRef = secretStorageService.createProviderConnectionSecretRef(providerId, accountId, fieldId);
      return secretRef.trim() === expectedRef ? [[fieldId, expectedRef]] : [];
    }),
  );
}

function isConnectionSchemaSatisfied(
  schema: LlmProviderConnectionSchema | undefined,
  connectionValues: Record<string, string>,
  secretPresence: Record<string, boolean>,
): boolean {
  if (!schema || schema.fields.length === 0) {
    return true;
  }
  const isPresent = (fieldId: string): boolean => {
    const field = schema.fields.find((candidate) => candidate.id === fieldId);
    return field?.kind === 'secret'
      ? secretPresence[fieldId] === true
      : Boolean(connectionValues[fieldId]?.trim());
  };
  const alternativeFieldIds = new Set(
    schema.credentialAlternatives?.flatMap((alternative) => alternative.fieldIds) ?? [],
  );
  const requiredFieldsPresent = schema.fields
    .filter((field) => field.required && !alternativeFieldIds.has(field.id))
    .every((field) => isPresent(field.id));
  if (!requiredFieldsPresent) {
    return false;
  }
  return !schema.credentialAlternatives?.length
    || schema.credentialAlternatives.some((alternative) => (
      alternative.ambient === true
      || (alternative.fieldIds.length > 0 && alternative.fieldIds.every(isPresent))
    ));
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

  const builtinFallback = createProviderEntryFromCatalog(rawId);
  const definition = builtinFallback;
  const authMode = resolveProviderAuthMode(provider, builtinFallback);
  const authAccountIds = sanitizeAuthAccountIds(provider, authMode);
  const activeAccountId = authAccountIds[authMode];
  const connectionSchema = cloneConnectionSchema(builtinFallback.connectionSchema);
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(connectionSchema);
  const connectionValues = sanitizeConnectionValues(connectionSchema, provider.connectionValues);
  const secretRefs = sanitizeConnectionSecretRefs(
    rawId,
    authAccountIds['api-key'],
    connectionSchema,
    provider.secretRefs,
  );
  const secretRef = getProviderAccountSecretRef(rawId, authAccountIds['api-key'], 'api-key');
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const catalogOwnership = getProviderCatalogOwnership(rawId);
  const apiKeySecret = getResolvedProviderSecret(rawId, secretRef, workspaceRoot);
  const oauthSecret = secretStorageService.getSecret(
    getProviderAccountSecretRef(rawId, authAccountIds.account, 'oauth'),
    workspaceRoot,
  );
  const preserveStorageMetadata = options.credentialView === 'storage-metadata';
  const persistedApiKeyPresence = preserveStorageMetadata && (
    provider.hasStoredSecretByAuthMode?.['api-key'] === true
    || (authMode === 'api-key' && provider.hasStoredSecret === true)
  );
  const hasStoredConnectionSecrets = Object.fromEntries(
    (connectionSchema?.fields ?? [])
      .filter((field) => field.kind === 'secret')
      .map((field) => {
        const present = field.id === primarySecretFieldId
          ? Boolean(apiKeySecret) || persistedApiKeyPresence
          : Boolean(secretStorageService.getSecret(secretRefs[field.id], workspaceRoot))
            || (preserveStorageMetadata && (
              secretStorageService.hasSecretRecord(secretRefs[field.id], workspaceRoot)
              || provider.hasStoredConnectionSecrets?.[field.id] === true
            ));
        return [field.id, present];
      }),
  ) as Record<string, boolean>;
  const apiKeyCredentialPresent = connectionSchema?.fields.length
    ? isConnectionSchemaSatisfied(connectionSchema, connectionValues, hasStoredConnectionSecrets)
    : Boolean(apiKeySecret) || persistedApiKeyPresence;
  const hasStoredSecretByAuthMode = Object.fromEntries(
    (builtinFallback.authModeOptions ?? [builtinFallback.authMode]).map((mode) => {
      const persisted = preserveStorageMetadata && (
        provider.hasStoredSecretByAuthMode?.[mode] === true
        || (mode === authMode && provider.hasStoredSecret === true)
      );
      const present = mode === 'local' || mode === 'environment'
        ? true
        : mode === 'api-key'
          ? apiKeyCredentialPresent
          : Boolean(oauthSecret) || persisted;
      return [mode, present];
    }),
  ) as Partial<Record<LlmProviderAuthMode, boolean>>;
  const hasStoredSecret = hasStoredSecretByAuthMode[authMode] === true;
  const persistedModels = resolveProviderModels(rawId, provider.models ?? []);
  const structuralMetadataById = new Map(
    getProviderCatalogModelSummaries(rawId).map((metadata) => [metadata.modelId, metadata]),
  );
  const structuralModels = getProviderModelSummaries(rawId)
    .filter((model) => structuralMetadataById.get(model.id)?.presencePolicy === 'maintained');
  const structuralModelsById = new Map(structuralModels.map((model) => [model.id, model]));
  // Account discovery is scoped to the active identity. Once its credential is
  // absent, retain only released structural rows and discard account-specific
  // dynamic models and availability overlays.
  const models = catalogOwnership !== 'user-managed' && (authMode !== 'account' || hasStoredSecretByAuthMode.account === true)
    ? persistedModels
    : authMode === 'account' && hasStoredSecretByAuthMode.account !== true
    ? applyModelEnabledState(structuralModels, persistedModels).map((model) => {
        const structural = structuralModelsById.get(model.id);
        return {
          ...model,
          availability: structural?.availability,
          availabilityReason: structural?.availabilityReason,
        };
      })
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
    routeCount: builtinFallback.routeCount,
    authMode,
    authModeOptions: builtinFallback.authModeOptions,
    authModeAvailability: builtinFallback.authModeAvailability,
    hasStoredSecretByAuthMode,
    configuredAuthMode,
    lifecycleStatus: builtinFallback.lifecycleStatus,
    providerAvailability: { ...builtinFallback.providerAvailability },
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode }),
    catalogOwnership,
    serviceOperator: builtinFallback.serviceOperator,
    endpointClass: builtinFallback.endpointClass,
    catalogProvenance: builtinFallback.catalogProvenance.map((entry) => ({ ...entry })),
    label,
    enabled,
    apiKey: '',
    secretRef,
    secretRefs,
    connectionValues,
    hasStoredConnectionSecrets,
    connectionSchema,
    hasStoredSecret,
    baseUrl: (() => {
      const defaultBaseUrl = getProviderDefaultBaseUrl(rawId);
      if (definition?.baseUrlEditable) {
        return typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
          ? provider.baseUrl.trim()
          : defaultBaseUrl ?? definition.baseUrl;
      }
      return definition?.baseUrl;
    })(),
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

  return createProviderEntriesFromCatalog()
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
    const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(provider.connectionSchema);
    const apiKeySecret = getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
    const oauthSecret = secretStorageService.getSecret(
      getProviderAccountSecretRef(provider.id, provider.authAccountIds?.account, 'oauth'),
      workspaceRoot,
    );
    const hasStoredConnectionSecrets = Object.fromEntries(
      (provider.connectionSchema?.fields ?? [])
        .filter((field) => field.kind === 'secret')
        .map((field) => [
          field.id,
          field.id === primarySecretFieldId
            ? Boolean(apiKeySecret)
            : Boolean(secretStorageService.getSecret(provider.secretRefs?.[field.id], workspaceRoot)),
        ]),
    ) as Record<string, boolean>;
    const apiKeyCredentialPresent = provider.connectionSchema?.fields.length
      ? isConnectionSchemaSatisfied(
          provider.connectionSchema,
          provider.connectionValues ?? {},
          hasStoredConnectionSecrets,
        )
      : Boolean(apiKeySecret);
    const hasStoredSecretByAuthMode = Object.fromEntries(
      (provider.authModeOptions ?? [provider.authMode]).map((mode) => [
        mode,
        mode === 'local' || mode === 'environment'
          ? true
          : mode === 'api-key'
            ? apiKeyCredentialPresent
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
      hasStoredConnectionSecrets,
      enabled: isConfigured,
      status,
      isConfigured,
    };
  });
}

function normalizeManifestRoutes(
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
    // MODEL_UNAVAILABLE without rewriting the canonical manifest or silently substituting a model.
  }

  return Array.from(routeMap.values());
}

export class SettingsService {
  private initialized = false;
  private readonly agentDefinitionRevisions = new Map<string, number>();
  private readonly agentDefinitionCommits = new Map<string, AgentDefinitionCommitSnapshot>();
  private readonly agentDefinitionWriteTails = new Map<string, Promise<void>>();
  private readonly providerDefinitionRevisions = new Map<string, number>();
  private readonly providerDefinitionCommits = new Map<string, ProviderDefinitionCommitSnapshot>();
  private readonly providerDefinitionWriteTails = new Map<string, Promise<void>>();

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

    const rawProviders = persistedRawProviders;

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

      const builtin = createProviderEntryFromCatalog(rawId);
      const authMode = resolveProviderAuthMode(entry, builtin);
      const authAccountIds = sanitizeAuthAccountIds(entry, authMode);
      const unkeyedApiKeyRef = secretStorageService.createProviderSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === 'string' && entry.secretRef.trim()
        ? entry.secretRef.trim()
        : undefined;
      const secretRef = incomingSecretRef || unkeyedApiKeyRef;

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
      },
    };

    return {
      settings: nextSettings,
      changed: JSON.stringify(candidate) !== JSON.stringify(nextSettings),
      fixes,
      warnings,
      secretRefsToDelete: [],
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
    const baseAgentSettings = agentManifestService.getSettings(
      paths,
      hydratedProviders,
      createEmptyAgentRoutes(),
    );
    const agentRoutes = normalizeManifestRoutes(
      agentManifestService.routesFromDefinitions(createEmptyAgentRoutes(), baseAgentSettings.definitions),
    );

    const settings: AppSettings = {
      ...createDefaultRuntimeSettings(),
      appearance: normalized.appearance,
      layout: normalized.layout,
      profile: normalized.profile,
      tooling: normalized.tooling,
      agentRuntime: normalized.agentRuntime,
      llm: {
        providers: hydratedProviders,
        agentRoutes,
      },
      agents: agentManifestService.projectEffectiveModelOptions(
        baseAgentSettings,
        hydratedProviders,
        agentRoutes,
        [],
      ),
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

  private async writeSettingsAsync(settings: PersistedSettingsPayload): Promise<void> {
    const filePath = appPathService.getRuntimePaths().settingsPath;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      await fs.promises.rename(temporaryPath, filePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
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

  /** Main-process only. Never expose this hydrated map through settings IPC. */
  getProviderConnectionValues(
    providerId: string,
    workspaceRoot = appPathService.getUserRdxRoot(),
  ): Record<string, string> {
    this.ensureInitialized();
    const persisted = this.normalizePersistedSettings(
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
    if (typeof patch.agents?.globalInstructions === 'string') {
      agentManifestService.saveGlobalInstructions(nextPaths, patch.agents.globalInstructions);
    }

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
      },
    };

    this.writeSettings(nextPersisted);
    this.deleteSecretsAfterCommit(secretRefsToDelete, nextPaths.userRdxRoot);
    return this.getAll({
      ...nextPaths,
      ...(runtimePaths ?? {}),
    });
  }

  private async withAgentDefinitionWriteLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.agentDefinitionWriteTails.get(agentId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.agentDefinitionWriteTails.set(agentId, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.agentDefinitionWriteTails.get(agentId) === tail) {
        this.agentDefinitionWriteTails.delete(agentId);
      }
    }
  }

  private async readAgentDefinitionCommit(agentId: string): Promise<AgentDefinitionCommitSnapshot | null> {
    const cached = this.agentDefinitionCommits.get(agentId);
    const definition = await agentManifestService.readDefinition(appPathService.getRuntimePaths(), agentId);
    if (!definition) {
      return cached?.definition === null ? cached : null;
    }
    const commitHash = await agentManifestService.readCommitHash(definition.filePath);
    if (cached?.commitHash === commitHash) {
      const refreshed = {
        ...cached,
        definition,
        route: agentManifestService.routeFromDefinition(definition),
      };
      this.agentDefinitionCommits.set(agentId, refreshed);
      return refreshed;
    }
    const snapshot: AgentDefinitionCommitSnapshot = {
      clientRevision: 0,
      commitHash,
      definition,
      route: agentManifestService.routeFromDefinition(definition),
    };
    this.agentDefinitionCommits.set(agentId, snapshot);
    return snapshot;
  }

  private saveResult(
    request: AgentDefinitionSaveRequest,
    status: AgentDefinitionSaveResult['status'],
    snapshot: AgentDefinitionCommitSnapshot | null,
    error?: string,
  ): AgentDefinitionSaveResult {
    return {
      clientRevision: request.clientRevision,
      status,
      commitHash: snapshot?.commitHash ?? null,
      definition: snapshot?.definition ?? null,
      route: snapshot?.route ?? null,
      lastSuccessful: snapshot,
      ...(error ? { error } : {}),
    };
  }

  private async restoreAgentDefinitionCommit(
    paths: Pick<AppRuntimePaths, 'agentsPath' | 'instructionsPath'>,
    request: AgentDefinitionSaveRequest,
    snapshot: AgentDefinitionCommitSnapshot | null,
  ): Promise<void> {
    if (!snapshot?.definition) {
      await agentManifestService.saveDefinition(paths, { ...request.draft, delete: true });
      return;
    }
    const {
      filePath: _filePath,
      builtin: _builtin,
      updatedAt: _updatedAt,
      ...draft
    } = snapshot.definition;
    await agentManifestService.saveDefinition(paths, draft as AgentManifestDraft);
  }

  async getAgentDefinitionCommit(agentIdDraft: string): Promise<AgentDefinitionCommitSnapshot | null> {
    this.ensureInitialized();
    const agentId = agentIdDraft.trim();
    if (!isSafeAgentProfileId(agentId)) return null;
    return this.readAgentDefinitionCommit(agentId);
  }

  async saveAgentDefinition(request: AgentDefinitionSaveRequest): Promise<AgentDefinitionSaveResult> {
    this.ensureInitialized();
    const agentId = request.draft.id.trim();
    if (!isSafeAgentProfileId(agentId)) {
      return this.saveResult(request, 'failed', null, `Invalid agent profile id: ${agentId || '<empty>'}`);
    }
    if (!Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      return this.saveResult(request, 'failed', await this.readAgentDefinitionCommit(agentId), 'clientRevision must be a positive safe integer.');
    }

    const latestRevision = this.agentDefinitionRevisions.get(agentId) ?? 0;
    if (request.clientRevision <= latestRevision) {
      return this.saveResult(request, 'superseded', await this.readAgentDefinitionCommit(agentId));
    }
    this.agentDefinitionRevisions.set(agentId, request.clientRevision);
    await Promise.resolve();

    return this.withAgentDefinitionWriteLock(agentId, async () => {
      const previous = await this.readAgentDefinitionCommit(agentId);
      if (this.agentDefinitionRevisions.get(agentId) !== request.clientRevision) {
        return this.saveResult(request, 'superseded', previous);
      }
      const paths = appPathService.getRuntimePaths();
      try {
        const commit = await agentManifestService.saveDefinition(paths, request.draft);
        if (this.agentDefinitionRevisions.get(agentId) !== request.clientRevision) {
          await this.restoreAgentDefinitionCommit(paths, request, previous);
          return this.saveResult(request, 'superseded', previous);
        }
        const snapshot: AgentDefinitionCommitSnapshot = {
          clientRevision: request.clientRevision,
          commitHash: commit.commitHash,
          definition: commit.definition,
          route: commit.definition ? agentManifestService.routeFromDefinition(commit.definition) : null,
        };
        this.agentDefinitionCommits.set(agentId, snapshot);
        return this.saveResult(request, 'committed', snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.agentDefinitionRevisions.get(agentId) === request.clientRevision
          ? this.saveResult(request, 'failed', previous, message)
          : this.saveResult(request, 'superseded', previous);
      }
    });
  }

  private async withProviderDefinitionWriteLock<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.providerDefinitionWriteTails.get(providerId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.providerDefinitionWriteTails.set(providerId, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.providerDefinitionWriteTails.get(providerId) === tail) {
        this.providerDefinitionWriteTails.delete(providerId);
      }
    }
  }

  private providerSaveResult(
    request: ProviderDefinitionSaveRequest,
    status: ProviderDefinitionSaveResult['status'],
    snapshot: ProviderDefinitionCommitSnapshot | null,
    error?: string,
  ): ProviderDefinitionSaveResult {
    return {
      clientRevision: request.clientRevision,
      providerId: request.provider.id,
      status,
      commitHash: snapshot?.commitHash ?? null,
      provider: snapshot?.provider ?? null,
      catalogRevision: snapshot?.catalogRevision ?? null,
      lastSuccessful: snapshot,
      ...(error ? { error } : {}),
    };
  }

  private async readProviderDefinitionCommit(providerId: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    const provider = this.getAll().llm.providers.find((entry) => entry.id === providerId) ?? null;
    if (!provider) return null;
    const hash = hashProviderDefinition(provider);
    const cached = this.providerDefinitionCommits.get(providerId);
    const snapshot: ProviderDefinitionCommitSnapshot = {
      clientRevision: cached?.commitHash === hash ? cached.clientRevision : 0,
      providerId,
      commitHash: hash,
      provider,
      catalogRevision: cached?.catalogRevision ?? null,
    };
    this.providerDefinitionCommits.set(providerId, snapshot);
    return snapshot;
  }

  private async persistProviderDefinition(provider: LlmProviderEntry): Promise<LlmProviderEntry> {
    const paths = appPathService.initializeRuntime();
    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(paths.settingsPath) ?? createDefaultPersistedSettings(),
      paths.userRdxRoot,
      { credentialView: 'storage-metadata' },
    );
    const currentProviders = currentPersisted.llm?.providers ?? [];
    const current = currentProviders.find((entry) => entry.id === provider.id);
    if (!current) throw new Error(`Unknown provider: ${provider.id}`);
    const sanitized = sanitizeUserProvider({
      ...current,
      ...provider,
      apiKey: '',
      secretRef: current.secretRef,
      secretRefs: current.secretRefs,
      authAccountIds: current.authAccountIds,
      activeAccountId: current.activeAccountId,
      hasStoredSecretByAuthMode: current.hasStoredSecretByAuthMode,
      hasStoredConnectionSecrets: current.hasStoredConnectionSecrets,
    }, paths.userRdxRoot, { credentialView: 'storage-metadata' });
    if (!sanitized) throw new Error(`Provider ${provider.id} could not be sanitized.`);
    const nextProviders = normalizeUserProviders(
      currentProviders.map((entry) => entry.id === provider.id ? sanitized : entry),
      paths.userRdxRoot,
      { credentialView: 'storage-metadata' },
    );
    await this.writeSettingsAsync({
      ...currentPersisted,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      llm: { providers: nextProviders.map((entry) => ({ ...entry, apiKey: '' })) },
    });
    const committed = this.getAll().llm.providers.find((entry) => entry.id === provider.id);
    if (!committed) throw new Error(`Provider ${provider.id} disappeared after commit.`);
    return committed;
  }

  async getProviderDefinitionCommit(providerIdDraft: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    this.ensureInitialized();
    const providerId = providerIdDraft.trim();
    if (!providerId) return null;
    return this.readProviderDefinitionCommit(providerId);
  }

  setProviderDefinitionCatalogRevision(providerId: string, catalogRevision: string | null): void {
    const snapshot = this.providerDefinitionCommits.get(providerId);
    if (snapshot) this.providerDefinitionCommits.set(providerId, { ...snapshot, catalogRevision });
  }

  async saveProviderDefinition(request: ProviderDefinitionSaveRequest): Promise<ProviderDefinitionSaveResult> {
    this.ensureInitialized();
    const providerId = request.provider.id.trim();
    const previous = await this.readProviderDefinitionCommit(providerId);
    if (!providerId || !Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      return this.providerSaveResult(request, 'failed', previous, 'clientRevision must be a positive safe integer.');
    }
    const latestRevision = this.providerDefinitionRevisions.get(providerId) ?? 0;
    if (request.clientRevision <= latestRevision) {
      return this.providerSaveResult(request, 'superseded', previous);
    }
    this.providerDefinitionRevisions.set(providerId, request.clientRevision);
    await Promise.resolve();
    return this.withProviderDefinitionWriteLock(providerId, async () => {
      if (this.providerDefinitionRevisions.get(providerId) !== request.clientRevision) {
        return this.providerSaveResult(request, 'superseded', previous);
      }
      try {
        const provider = await this.persistProviderDefinition(request.provider);
        if (this.providerDefinitionRevisions.get(providerId) !== request.clientRevision) {
          if (previous?.provider) await this.persistProviderDefinition(previous.provider);
          return this.providerSaveResult(request, 'superseded', previous);
        }
        const snapshot: ProviderDefinitionCommitSnapshot = {
          clientRevision: request.clientRevision,
          providerId,
          commitHash: hashProviderDefinition(provider),
          provider,
          catalogRevision: null,
        };
        this.providerDefinitionCommits.set(providerId, snapshot);
        return this.providerSaveResult(request, 'committed', snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.providerDefinitionRevisions.get(providerId) === request.clientRevision
          ? this.providerSaveResult(request, 'failed', previous, message)
          : this.providerSaveResult(request, 'superseded', previous);
      }
    });
  }

  saveProviderConnection(
    providerId: LlmProviderId,
    apiKey: string,
    models: LlmProviderModel[],
    baseUrl = '',
    protocolDraft?: unknown,
    authModeDraft?: LlmProviderAuthMode,
    modelPreferences?: LlmProviderModelPreference[],
    connectionValuesDraft?: Record<string, string>,
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
    const authAvailability = resolveSelectedAuthAvailability(provider.id, authMode, createProviderEntryFromCatalog(provider.id));
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
    const defaultBaseUrl = getProviderDefaultBaseUrl(provider.id);
    const nextBaseUrl = provider.baseUrlEditable
      ? (baseUrl.trim() || defaultBaseUrl || provider.baseUrl)
      : (defaultBaseUrl || provider.baseUrl);
    const schema = provider.connectionSchema;
    const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(schema) ?? 'apiKey';
    const existingHydratedValues = this.getProviderConnectionValues(provider.id, current.paths.userRdxRoot);
    const draftHas = (fieldId: string): boolean => (
      Object.prototype.hasOwnProperty.call(connectionValuesDraft ?? {}, fieldId)
    );
    const nextConnectionValues = sanitizeConnectionValues(schema, {
      ...(provider.connectionValues ?? {}),
      ...Object.fromEntries(
        (schema?.fields ?? [])
          .filter((field) => field.kind !== 'secret' && draftHas(field.id))
          .map((field) => [field.id, connectionValuesDraft?.[field.id] ?? '']),
      ),
    });
    const plannedSecrets = Object.fromEntries(
      (schema?.fields ?? [])
        .filter((field) => field.kind === 'secret')
        .map((field) => {
          const drafted = field.id === primarySecretFieldId
            ? apiKey.trim() || (draftHas(field.id) ? connectionValuesDraft?.[field.id]?.trim() ?? '' : '')
            : draftHas(field.id)
              ? connectionValuesDraft?.[field.id]?.trim() ?? ''
              : '';
          const retainExisting = !draftHas(field.id) && (field.id !== primarySecretFieldId || !apiKey.trim());
          return [field.id, drafted || (retainExisting ? existingHydratedValues[field.id] ?? '' : '')];
        }),
    ) as Record<string, string>;
    const plannedSecretPresence = Object.fromEntries(
      Object.entries(plannedSecrets).map(([fieldId, value]) => [fieldId, Boolean(value)]),
    ) as Record<string, boolean>;
    const credentialSatisfied = schema?.fields.length
      ? isConnectionSchemaSatisfied(schema, nextConnectionValues, plannedSecretPresence)
      : Boolean(apiKey.trim() || provider.hasStoredSecretByAuthMode?.['api-key']);
    if (authMode === 'api-key' && !credentialSatisfied) {
      throw new Error('Provider connection fields are incomplete.');
    }

    const credentialChanged = (schema?.fields ?? [])
      .filter((field) => field.kind === 'secret')
      .some((field) => (plannedSecrets[field.id] ?? '') !== (existingHydratedValues[field.id] ?? ''));
    const currentAccountId = provider.authAccountIds?.['api-key'];
    const nextAccountId = credentialSatisfied
      ? (!currentAccountId || credentialChanged ? createLocalAccountId() : currentAccountId)
      : undefined;
    const nextAuthAccountIds = { ...(provider.authAccountIds ?? {}) };
    if (nextAccountId) {
      nextAuthAccountIds['api-key'] = nextAccountId;
    } else {
      delete nextAuthAccountIds['api-key'];
    }
    const nextPrimarySecretRef = getProviderAccountSecretRef(provider.id, nextAccountId, 'api-key');
    const nextSecretRefs: Record<string, string> = {};
    const stagedSecretRefs = new Set<string>();
    const retainedSecretRefs = new Set<string>();
    const previousSecretRefs = new Set<string>([
      ...(provider.secretRef ? [provider.secretRef] : []),
      ...Object.values(provider.secretRefs ?? {}),
    ]);

    if (nextAccountId) {
      for (const field of schema?.fields ?? []) {
        if (field.kind !== 'secret' || !plannedSecrets[field.id]) {
          continue;
        }
        const targetRef = field.id === primarySecretFieldId
          ? nextPrimarySecretRef
          : secretStorageService.createProviderConnectionSecretRef(provider.id, nextAccountId, field.id);
        if (!targetRef) {
          continue;
        }
        if (field.id !== primarySecretFieldId) {
          nextSecretRefs[field.id] = targetRef;
        }
        retainedSecretRefs.add(targetRef);
        if (credentialChanged || !secretStorageService.hasSecretRecord(targetRef, current.paths.userRdxRoot)) {
          secretStorageService.setSecret(targetRef, plannedSecrets[field.id], current.paths.userRdxRoot);
          stagedSecretRefs.add(targetRef);
        }
      }
    }

    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode,
      activeAccountId: authMode === 'api-key' ? nextAccountId : provider.authAccountIds?.[authMode],
      authAccountIds: nextAuthAccountIds,
      apiKey: '',
      secretRef: nextPrimarySecretRef,
      secretRefs: nextSecretRefs,
      connectionValues: nextConnectionValues,
      hasStoredConnectionSecrets: plannedSecretPresence,
      protocol,
      enabled: hasEnabledModels,
      hasStoredSecret: authMode === 'api-key'
        ? credentialSatisfied
        : authMode === 'local' || authMode === 'environment',
      hasStoredSecretByAuthMode: {
        ...(provider.hasStoredSecretByAuthMode ?? {}),
        [authMode]: authMode === 'api-key' ? credentialSatisfied : true,
      },
      configuredAuthMode: authMode,
      baseUrl: nextBaseUrl,
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

    try {
      const nextSettings = this.setAll({
        llm: {
          providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        },
      });
      this.deleteSecretsAfterCommit(
        [...previousSecretRefs].filter((secretRef) => !retainedSecretRefs.has(secretRef)),
        current.paths.userRdxRoot,
      );
      return nextSettings;
    } catch (error) {
      this.deleteSecretsAfterCommit(
        [...stagedSecretRefs].filter((secretRef) => !previousSecretRefs.has(secretRef)),
        current.paths.userRdxRoot,
      );
      throw error;
    }
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
        },
      });
      this.deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], current.paths.userRdxRoot);
      return nextSettings;
    }

    const fallback = createProviderEntryFromCatalog(provider.id);
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
