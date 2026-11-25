import { createHash } from 'crypto';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_AGENT_RUNTIME,
  DEFAULT_LAYOUT,
  DEFAULT_PROFILE,
  DEFAULT_CODE_INTERPRETER,
  DEFAULT_RDC_CLI_INVOKER,
  DEFAULT_SHELL_TOOLING,
  EMPTY_PATHS,
} from '@shared/constants/appSettingsDefaults';
import { errorCodeOf } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import { executionProfileService } from './ExecutionProfileService';
import { tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';
import { secretStorageService } from './SecretStorageService';
import { createDefaultSettingsFile } from './settingsDefaults';
import { SettingsFileError, assertSettingsFile, parseSettingsFile, type SettingsFile } from './settingsFileSchema';
import { composeProviders } from './providerUserState';
import { createEmptyAgentRoutes, normalizeManifestRoutes } from './settingsProviderSanitize';
import type {
  AppRuntimePaths,
  AppSettings,
  LlmProviderEntry,
  RuntimeResourceCatalog,
  SettingsDiagnostic,
} from '@shared/types/settings';

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
    tooling: {
      rdcCli: DEFAULT_RDC_CLI_INVOKER,
      codeInterpreter: DEFAULT_CODE_INTERPRETER,
      shell: DEFAULT_SHELL_TOOLING,
    },
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    agentModels: { default: {}, byAgent: {} },
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

/**
 * The one read of the settings file: missing is `null` (defaults, nothing written); anything that is not a valid v9
 * document is a `SettingsFileError` naming the file, whatever the storage primitive reported.
 */
export function readSettingsFile(filePath = appPathService.getRuntimePaths().settingsPath): SettingsFile | null {
  try {
    return readValidatedSync(filePath, parseJsonWith(parseSettingsFile));
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === 'STORAGE_CORRUPT' || code === 'STORAGE_SCHEMA_UNSUPPORTED' || code === 'STORAGE_UNREADABLE') {
      throw new SettingsFileError(code, filePath, { cause: error });
    }
    throw error;
  }
}

export function readSettingsFileOrDefaults(filePath?: string): SettingsFile {
  return readSettingsFile(filePath) ?? createDefaultSettingsFile();
}

/** Writes the whole document compactly and atomically; callers write only when something actually changed. */
export function writeSettingsFile(file: SettingsFile, filePath = appPathService.getRuntimePaths().settingsPath): void {
  writeFileAtomicSync(filePath, JSON.stringify(assertSettingsFile(file)));
}

export function deleteSecretsAfterCommit(secretRefs: Iterable<string>, workspaceRoot: string): void {
  for (const secretRef of new Set(secretRefs)) {
    secretStorageService.deleteSecret(secretRef, workspaceRoot);
  }
}

function orphanProviderDiagnostics(providerIds: string[], settingsPath: string): SettingsDiagnostic[] {
  return providerIds.map((providerId) => ({
    code: 'settings_provider_not_in_catalog',
    severity: 'warning',
    message: `Stored settings for provider ${providerId} are kept but not used: the provider catalog no longer lists it.`,
    path: settingsPath,
  }));
}

export function toRuntimeSettings(
  file: SettingsFile,
  runtimePaths?: Partial<AppRuntimePaths>,
): AppSettings {
  const workspaceRoot = appPathService.getUserRdcRoot();
  const paths = appPathService.getRuntimePaths();
  const { providers, orphanProviderIds } = composeProviders(file.providers, workspaceRoot);
  const resourceCatalog: RuntimeResourceCatalog = executionProfileService.normalizeResourceCatalog({
    availableSkills: [],
    availableMcpServers: [],
    diagnostics: [],
  });
  const baseAgentSettings = agentManifestService.getSettings(
    paths,
    providers,
    createEmptyAgentRoutes(),
    [],
    tryCurrentProjectRoot(),
  );
  const agentRoutes = normalizeManifestRoutes(
    agentManifestService.routesFromDefinitions(createEmptyAgentRoutes(), baseAgentSettings.definitions),
  );

  const settings: AppSettings = {
    ...createDefaultRuntimeSettings(),
    appearance: file.appearance,
    layout: file.layout,
    profile: file.profile,
    tooling: file.tooling,
    agentRuntime: file.agentRuntime,
    agentModels: file.agentModels,
    llm: {
      providers,
      agentRoutes,
    },
    agents: agentManifestService.projectEffectiveModelOptions(
      baseAgentSettings,
      providers,
      agentRoutes,
      [],
    ),
    resourceCatalog,
    paths: {
      ...paths,
      ...(runtimePaths ?? {}),
    },
  };

  settings.resourceCatalog.diagnostics = [
    ...executionProfileService.getDiagnostics(settings),
    ...orphanProviderDiagnostics(orphanProviderIds, paths.settingsPath),
  ];
  return settings;
}
