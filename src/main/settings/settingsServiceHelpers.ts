import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import type {
  AppRuntimePaths,
  AppSettings,
  LayoutPreferences,
  LlmProviderEntry,
  ProfileSettings,
  RuntimeResourceCatalog,
  ToolingSettings,
  AgentRuntimeSettings,
  UiPreferences,
} from '@shared/types/settings';
import { createDefaultChromeThemes } from '@shared/theme/presets';
import { sanitizeUiPreferences } from '@shared/theme/uiPreferences';
import {
  createProviderEntryFromCatalog,
  isBuiltinProviderId,
} from '../provider-catalog/ProviderCatalogRegistry';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from './AgentManifestService';
import { executionProfileService } from './ExecutionProfileService';
import { tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import { secretStorageService } from './SecretStorageService';
import { StorageSchemaError } from '../sessions/storageSchema';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_LAYOUT,
  DEFAULT_PROFILE,
  DEFAULT_CODE_INTERPRETER,
  DEFAULT_RDX_CLI_INVOKER,
  DEFAULT_SHELL_TOOLING,
  EMPTY_PATHS,
  LEFT_DEFAULTS,
  RIGHT_DEFAULTS,
  SETTINGS_SCHEMA_VERSION,
  createDefaultPersistedSettings,
  type PersistedSettingsPayload,
} from './settingsDefaults';
import {
  sanitizeAgentRuntimeSettings,
  sanitizeSidebar,
  sanitizeTerminal,
  sanitizeWindow,
  sanitizeToolingSettings,
} from './settingsSanitize';
import {
  createEmptyAgentRoutes,
  hydrateProviderSecrets,
  isFixtureProvider,
  normalizeManifestRoutes,
  normalizeUserProviders,
  resolveProviderAuthMode,
  sanitizeAuthAccountIds,
  sanitizeUserProvider,
  type ProviderSanitizeOptions,
} from './settingsProviderSanitize';

export interface HardRebuildResult {
  settings: PersistedSettingsPayload;
  changed: boolean;
  fixes: string[];
  warnings: string[];
  secretRefsToDelete: string[];
}

export interface NormalizedPersistedSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  llm: {
    providers: LlmProviderEntry[];
  };
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashProviderDefinition(provider: LlmProviderEntry): string {
  return createHash('sha256').update(stableSerialize({ ...provider, apiKey: '' }), 'utf8').digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function readJsonFile<T>(filePath: string): T | null {
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

export function assertPersistedSettingsSchemaVersion(raw: unknown, filePath: string): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return;
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version == null) {
    return;
  }
  const numeric = typeof version === 'number' ? version : Number(version);
  if (Number.isFinite(numeric) && numeric > SETTINGS_SCHEMA_VERSION) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA_UNSUPPORTED: ${filePath} has schemaVersion ${version}; supported up to ${SETTINGS_SCHEMA_VERSION}`,
    );
  }
}

/** Async counterpart of `readJsonFile` for event-loop-friendly reads. */
export async function readJsonFileAsync<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      console.warn('[SettingsService] Failed to read JSON:', filePath, error);
    }
    return null;
  }
}

export function createDefaultRuntimeSettings(): AppSettings {
  const resourceCatalog = executionProfileService.normalizeResourceCatalog({
    availableSkills: [],
    availableMcpServers: [],
    diagnostics: [],
  });

  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    tooling: {
      rdxCli: DEFAULT_RDX_CLI_INVOKER,
      codeInterpreter: DEFAULT_CODE_INTERPRETER,
      shell: DEFAULT_SHELL_TOOLING,
    },
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
      diagnostics: [],
    },
    resourceCatalog,
    paths: EMPTY_PATHS,
  };
}

export function rebuildPersistedSettings(
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

  const previousSchemaVersion = typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0;
  const appearance = sanitizeUiPreferences(
    candidate.appearance,
    sanitizeUiPreferences(fallback.appearance, DEFAULT_APPEARANCE),
  );
  // Schema 6: clear Appearance chrome pollution from dual-theme bring-up and restore RDC defaults.
  if (previousSchemaVersion < 6) {
    appearance.chromeThemes = createDefaultChromeThemes();
    fixes.push('Reset appearance.chromeThemes to RDC preset defaults (schema 6)');
  }

  const incomingLlm = candidate.llm && typeof candidate.llm === 'object' && !Array.isArray(candidate.llm)
    ? candidate.llm as { embedding?: unknown; providers?: unknown }
    : undefined;
  if (incomingLlm && Object.prototype.hasOwnProperty.call(incomingLlm, 'embedding')) {
    fixes.push('Removed persisted embedding selection (schema 7)');
  }

  const nextSettings: PersistedSettingsPayload = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance,
    layout: {
      leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
      rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
      terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal),
      window: sanitizeWindow(candidate.layout?.window, fallback.layout?.window ?? DEFAULT_LAYOUT.window),
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

export function normalizePersistedSettings(
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
    appearance: sanitizeUiPreferences(
      candidate.appearance,
      sanitizeUiPreferences(fallback.appearance, DEFAULT_APPEARANCE),
    ),
    layout: {
      leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
      rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
      terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal),
      window: sanitizeWindow(candidate.layout?.window, fallback.layout?.window ?? DEFAULT_LAYOUT.window),
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

export function writeSettings(settings: PersistedSettingsPayload): void {
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

export async function writeSettingsAsync(settings: PersistedSettingsPayload): Promise<void> {
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

export function deleteSecretsAfterCommit(secretRefs: Iterable<string>, workspaceRoot: string): void {
  for (const secretRef of new Set(secretRefs)) {
    secretStorageService.deleteSecret(secretRef, workspaceRoot);
  }
}

export function toRuntimeSettings(
  persisted: PersistedSettingsPayload,
  runtimePaths?: Partial<AppRuntimePaths>,
): AppSettings {
  const workspaceRoot = appPathService.getUserRdxRoot();
  const normalized = normalizePersistedSettings(persisted, workspaceRoot);
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
    [],
    tryCurrentProjectRoot(),
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
