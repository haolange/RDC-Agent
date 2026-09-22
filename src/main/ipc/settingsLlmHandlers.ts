import { ipcMain } from 'electron';
import type {
  AppSettings,
  AppSettingsPatch,
  LlmModelCapabilityProbeRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderDraftRequest,
  LlmProviderId,
  ProviderDefinitionSaveRequest,
} from '@shared/types/settings';
import type { AgentDefinitionSaveRequest } from '@shared/types/agentManifest';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from '../settings/AgentManifestService';
import { resolveCompiledRouteForAgent } from '../settings/compiledAgentRoutes';
import { tryCurrentProjectRoot } from '../settings/resolveRegisteredProjectRoot';
import { providerConnectionService } from '../settings/ProviderConnectionService';
import { settingsService } from '../settings/SettingsService';
import { resolveEffectiveCatalog, resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { effectiveCatalogService } from '../settings/EffectiveCatalogService';
import { providerCapabilityProbeService } from '../settings/ProviderCapabilityProbeService';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { applyProductIcon } from '../window/productIcon';
import { formatShellInterpreterLabel, shellResolver } from '../runtime/ShellResolver';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  SettingsGetEffectiveCatalogArgsSchema,
  SettingsGetResolvedShellArgsSchema,
  SettingsHasProviderSecretArgsSchema,
  SettingsImportAgentManifestArgsSchema,
  SettingsProviderIdArgsSchema,
  SettingsSetArgsSchema,
  SettingsAgentIdArgsSchema,
} from './validation/ipcSchemas';
import {
  LlmModelCapabilityProbeArgsSchema,
  LlmProviderAccountLoginFinishArgsSchema,
  LlmProviderAccountLoginStartArgsSchema,
  LlmProviderDraftArgsSchema,
  LlmProviderIdArgsSchema,
  SettingsGetAgentDefinitionCommitArgsSchema,
  SettingsSaveAgentDefinitionArgsSchema,
  SettingsSaveProviderDefinitionArgsSchema,
  SettingsGetModelsOverrideArgsSchema,
  SettingsSetModelsOverrideArgsSchema,
} from './validation/settingsLlmSchemas';
import type { ModelsOverride } from '@shared/provider-catalog/modelsOverrideSchema';
import { modelsOverrideService } from '../settings/ModelsOverrideService';

export function registerSettingsLlmHandlers(context: WorkbenchIpcContext): void {
  effectiveCatalogService.setDiscoveryLoaderResolver((request) => (
    providerConnectionService.createEffectiveCatalogDiscoveryLoader(request)
  ));
  effectiveCatalogService.subscribe((snapshot) => {
    context.broadcastToRenderer('llm:effectiveCatalogChanged', snapshot);
  });

  const withEffectiveAgentModelOptions = async (settings: AppSettings): Promise<AppSettings> => {
    const catalogProviderIds = agentManifestService.modelOptionCatalogProviderIds(
      settings.llm.providers,
      settings.llm.agentRoutes,
    );
    await Promise.all(catalogProviderIds.map((providerId) => loadProviderSurface(providerId)));
    const catalogs = settings.llm.providers.flatMap((provider) => {
      if (provider.catalogOwnership === 'user-managed' || !catalogProviderIds.includes(provider.id)) return [];
      const snapshot = resolveEffectiveCatalog(provider.id, settings);
      return snapshot ? [snapshot] : [];
    });
    return {
      ...settings,
      agents: agentManifestService.projectEffectiveModelOptions(
        settings.agents,
        settings.llm.providers,
        settings.llm.agentRoutes,
        catalogs,
      ),
    };
  };

  const broadcastCatalog = async (providerId: string): Promise<void> => {
    await loadProviderSurface(providerId);
    const snapshot = resolveEffectiveCatalog(providerId, settingsService.getAll());
    if (snapshot) context.broadcastToRenderer('llm:effectiveCatalogChanged', snapshot);
  };
  ipcMain.handle('llm:testProviderDraft', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(LlmProviderDraftArgsSchema, rawArgs, {
      label: 'llm:testProviderDraft',
      maxBytes: 256 * 1024,
    }) as [LlmProviderDraftRequest];
    // refreshEffectiveCatalogDiscovery already emits via EffectiveCatalogService.subscribe.
    return providerConnectionService.testProviderDraft(request);
  });

  ipcMain.handle('llm:testModelCapability', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(LlmModelCapabilityProbeArgsSchema, rawArgs, {
      label: 'llm:testModelCapability',
      maxBytes: 8 * 1024,
    }) as [LlmModelCapabilityProbeRequest];
    return providerCapabilityProbeService.test(request);
  });

  ipcMain.handle('llm:connectProvider', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(LlmProviderDraftArgsSchema, rawArgs, {
      label: 'llm:connectProvider',
      maxBytes: 256 * 1024,
    }) as [LlmProviderDraftRequest];
    const result = await providerConnectionService.connectProvider(request);
    if (result.success) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:refreshProviderModels', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(LlmProviderIdArgsSchema, rawArgs, {
      label: 'llm:refreshProviderModels',
      maxBytes: 4 * 1024,
    }) as [LlmProviderId];
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      // Account Test already published via catalogPublisher; rebroadcast live account snapshot.
      // Api-key refresh also emitted via subscribe; broadcast keeps agent options in sync.
      await broadcastCatalog(providerId);
    }
    return result;
  });

  ipcMain.handle('llm:disconnectProvider', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(LlmProviderIdArgsSchema, rawArgs, {
      label: 'llm:disconnectProvider',
      maxBytes: 4 * 1024,
    }) as [LlmProviderId];
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(providerId);
    }
    return result;
  });

  ipcMain.handle('llm:startProviderAccountLogin', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(LlmProviderAccountLoginStartArgsSchema, rawArgs, {
      label: 'llm:startProviderAccountLogin',
      maxBytes: 8 * 1024,
    }) as [LlmProviderAccountLoginStartRequest];
    return providerConnectionService.startProviderAccountLogin(request);
  });

  ipcMain.handle('llm:getProviderAccountStatus', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(LlmProviderIdArgsSchema, rawArgs, {
      label: 'llm:getProviderAccountStatus',
      maxBytes: 4 * 1024,
    }) as [LlmProviderId];
    const result = providerConnectionService.getProviderAccountStatus(providerId);
    if (result.connected) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:finishProviderAccountLogin', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(LlmProviderAccountLoginFinishArgsSchema, rawArgs, {
      label: 'llm:finishProviderAccountLogin',
      maxBytes: 32 * 1024,
    }) as [LlmProviderAccountLoginFinishRequest];
    const result = await providerConnectionService.finishProviderAccountLogin(request);
    if (result.connected) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:logoutProviderAccount', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(LlmProviderIdArgsSchema, rawArgs, {
      label: 'llm:logoutProviderAccount',
      maxBytes: 4 * 1024,
    }) as [LlmProviderId];
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context.applyCurrentLlmConfig();
    await broadcastCatalog(providerId);
    return result;
  });

  ipcMain.handle('settings:get', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'settings:get', maxBytes: 1024 });
    const paths = appPathService.getRuntimePaths();
    return withEffectiveAgentModelOptions(settingsService.getAll({
      userRdcRoot: paths.userRdcRoot,
      settingsPath: paths.settingsPath,
      instructionsPath: paths.instructionsPath,
      agentsPath: paths.agentsPath,
      profileStatePath: paths.profileStatePath,
      logsPath: paths.logsPath,
      logPath: paths.logPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      policiesPath: paths.policiesPath,
      secretsPath: paths.secretsPath,
    }));
  });

  ipcMain.handle('settings:getProviderCatalog', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'settings:getProviderCatalog', maxBytes: 1024 });
    return settingsService.getProviderCatalog();
  });

  ipcMain.handle('settings:getEffectiveModel', async (_event, ...rawArgs: unknown[]) => {
    let agentId = 'unknown';
    try {
      [agentId] = parseIpcArgs(SettingsAgentIdArgsSchema, rawArgs, {
        label: 'settings:getEffectiveModel',
        maxBytes: 4 * 1024,
      });
      const settings = settingsService.getAll();
      const route = resolveCompiledRouteForAgent(agentId, settings, tryCurrentProjectRoot());
      if (!route?.providerId || !route.modelId) return null;
      await loadProviderSurface(route.providerId);
      return resolveEffectiveModel(route.providerId, route.modelId, settings);
    } catch (error) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'llm',
        severity: 'error',
        title: `Capability resolution failed for ${agentId || 'unknown Agent'}`,
        summary: 'The effective model capability could not be resolved.',
        detail: error instanceof Error ? error.name : 'UnknownError',
        raw: { code: 'EFFECTIVE_MODEL_CAPABILITY_RESOLUTION_FAILED', agentId },
      });
      throw error;
    }
  });

  ipcMain.handle('settings:getEffectiveCatalog', async (_event, ...rawArgs: unknown[]) => {
    const [providerId, accountId] = parseIpcArgs(SettingsGetEffectiveCatalogArgsSchema, rawArgs, {
      label: 'settings:getEffectiveCatalog',
      maxBytes: 4 * 1024,
      padTo: 2,
    });
    await loadProviderSurface(providerId);
    return resolveEffectiveCatalog(
      providerId,
      settingsService.getAll(),
      undefined,
      accountId ?? undefined,
    );
  });

  ipcMain.handle('settings:hasProviderSecret', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(SettingsHasProviderSecretArgsSchema, rawArgs, {
      label: 'settings:hasProviderSecret',
      maxBytes: 4 * 1024,
    });
    const paths = appPathService.getRuntimePaths();
    return settingsService.hasProviderSecret(providerId, paths.userRdcRoot);
  });

  ipcMain.handle('settings:importAgentManifest', async (_event, ...rawArgs: unknown[]) => {
    const [filePath] = parseIpcArgs(SettingsImportAgentManifestArgsSchema, rawArgs, {
      label: 'settings:importAgentManifest',
      maxBytes: 8 * 1024,
    });
    const paths = appPathService.getRuntimePaths();
    await agentManifestService.importFile(paths, filePath);
    return withEffectiveAgentModelOptions(settingsService.getAll(paths));
  });

  ipcMain.handle('settings:saveAgentDefinition', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsSaveAgentDefinitionArgsSchema, rawArgs, {
      label: 'settings:saveAgentDefinition',
      maxBytes: 2 * 1024 * 1024,
    }) as unknown as [AgentDefinitionSaveRequest];
    return settingsService.saveAgentDefinition(request);
  });

  ipcMain.handle('settings:getAgentDefinitionCommit', async (_event, ...rawArgs: unknown[]) => {
    const [query] = parseIpcArgs(SettingsGetAgentDefinitionCommitArgsSchema, rawArgs, {
      label: 'settings:getAgentDefinitionCommit',
      maxBytes: 4 * 1024,
    });
    return settingsService.getAgentDefinitionCommit(query);
  });

  ipcMain.handle('settings:saveProviderDefinition', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsSaveProviderDefinitionArgsSchema, rawArgs, {
      label: 'settings:saveProviderDefinition',
      maxBytes: 2 * 1024 * 1024,
    }) as unknown as [ProviderDefinitionSaveRequest];
    const result = await settingsService.saveProviderDefinition(request);
    if (result.status !== 'committed' || !result.provider) return result;
    context.applyCurrentLlmConfig();
    await loadProviderSurface(result.provider.id);
    const snapshot = resolveEffectiveCatalog(result.provider.id, settingsService.getAll());
    const catalogRevision = snapshot?.catalogRevision ?? null;
    settingsService.setProviderDefinitionCatalogRevision(result.provider.id, catalogRevision);
    if (snapshot) context.broadcastToRenderer('llm:effectiveCatalogChanged', snapshot);
    const lastSuccessful = result.lastSuccessful
      ? { ...result.lastSuccessful, catalogRevision }
      : null;
    return { ...result, catalogRevision, lastSuccessful };
  });

  ipcMain.handle('settings:getProviderDefinitionCommit', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(SettingsProviderIdArgsSchema, rawArgs, {
      label: 'settings:getProviderDefinitionCommit',
      maxBytes: 4 * 1024,
    });
    const commit = await settingsService.getProviderDefinitionCommit(providerId);
    if (!commit) return null;
    await loadProviderSurface(providerId);
    const snapshot = resolveEffectiveCatalog(providerId, settingsService.getAll());
    const catalogRevision = snapshot?.catalogRevision ?? null;
    settingsService.setProviderDefinitionCatalogRevision(providerId, catalogRevision);
    return { ...commit, catalogRevision };
  });

  ipcMain.handle('settings:set', async (_event, ...rawArgs: unknown[]) => {
    const [settings] = parseIpcArgs(SettingsSetArgsSchema, rawArgs, {
      label: 'settings:set',
      maxBytes: 2 * 1024 * 1024,
    });
    const patch = settings as AppSettingsPatch;
    const previousSettings = settingsService.getAll();
    const nextSettings = settingsService.setAll(patch, appPathService.getRuntimePaths());
    if (patch.appearance) applyProductIcon();
    const changedProviderIds = new Set<string>();
    if (patch.llm?.providers) context.applyCurrentLlmConfig();
    for (const provider of patch.llm?.providers ? nextSettings.llm.providers : []) {
      const previous = previousSettings.llm.providers.find((entry) => entry.id === provider.id);
      const changed = !previous || JSON.stringify(previous) !== JSON.stringify(provider);
      if (changed) changedProviderIds.add(provider.id);
    }
    const settledSettings = settingsService.getAll();
    for (const providerId of changedProviderIds) await broadcastCatalog(providerId);
    return withEffectiveAgentModelOptions(settledSettings);
  });

  ipcMain.handle('settings:getResolvedShell', async (_event, ...rawArgs: unknown[]) => {
    const [executable] = parseIpcArgs(SettingsGetResolvedShellArgsSchema, rawArgs, {
      label: 'settings:getResolvedShell',
      maxBytes: 8 * 1024,
    });
    try {
      const resolved = shellResolver.resolve(executable);
      return {
        ok: true,
        kind: resolved.kind,
        version: resolved.version,
        versionMajor: resolved.versionMajor,
        executable: resolved.executable,
        label: formatShellInterpreterLabel(resolved.kind),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('settings:getModelsOverride', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(SettingsGetModelsOverrideArgsSchema, rawArgs, {
      label: 'settings:getModelsOverride',
      maxBytes: 1024,
    });
    return modelsOverrideService.getOverrides();
  });

  ipcMain.handle('settings:setModelsOverride', async (_event, ...rawArgs: unknown[]) => {
    const [overrides] = parseIpcArgs(SettingsSetModelsOverrideArgsSchema, rawArgs, {
      label: 'settings:setModelsOverride',
      maxBytes: 512 * 1024,
    }) as [ModelsOverride];
    const saved = modelsOverrideService.setOverrides(overrides);
    // Rebroadcast affected provider catalogs so renderer picks up changes.
    const affectedProviderIds = Object.keys(saved.providers);
    for (const providerId of affectedProviderIds) {
      await broadcastCatalog(providerId);
    }
    return saved;
  });
}
