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
import { providerConnectionService } from '../settings/ProviderConnectionService';
import { settingsService } from '../settings/SettingsService';
import { resolveEffectiveCatalog, resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { effectiveCatalogService } from '../settings/EffectiveCatalogService';
import { providerCapabilityProbeService } from '../settings/ProviderCapabilityProbeService';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerSettingsLlmHandlers(context: WorkbenchIpcContext): void {
  effectiveCatalogService.setDiscoveryLoaderResolver((request) => (
    providerConnectionService.createEffectiveCatalogDiscoveryLoader(request)
  ));
  effectiveCatalogService.subscribe((snapshot) => {
    context.broadcastToRenderer('llm:effectiveCatalogChanged', snapshot);
  });

  const withEffectiveAgentModelOptions = async (settings: AppSettings): Promise<AppSettings> => {
    const selectedProviderIds = [...new Set(settings.llm.agentRoutes
      .map((route) => route.providerId)
      .filter((providerId): providerId is string => Boolean(providerId)))];
    await Promise.all(selectedProviderIds.map((providerId) => loadProviderSurface(providerId)));
    const catalogs = settings.llm.providers.flatMap((provider) => {
      if (provider.catalogOwnership === 'user-managed' || !selectedProviderIds.includes(provider.id)) return [];
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
  ipcMain.handle('llm:testProviderDraft', async (_event, request: LlmProviderDraftRequest) => {
    return providerConnectionService.testProviderDraft(request);
  });

  ipcMain.handle('llm:testModelCapability', async (_event, request: LlmModelCapabilityProbeRequest) => {
    return providerCapabilityProbeService.test(request);
  });

  ipcMain.handle('llm:connectProvider', async (_event, request: LlmProviderDraftRequest) => {
    const result = await providerConnectionService.connectProvider(request);
    if (result.success) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:refreshProviderModels', async (_event, providerId: LlmProviderId) => {
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(providerId);
    }
    return result;
  });

  ipcMain.handle('llm:disconnectProvider', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(providerId);
    }
    return result;
  });

  ipcMain.handle('llm:startProviderAccountLogin', async (_event, request: LlmProviderAccountLoginStartRequest) => {
    return providerConnectionService.startProviderAccountLogin(request);
  });

  ipcMain.handle('llm:getProviderAccountStatus', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.getProviderAccountStatus(providerId);
    if (result.connected) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:finishProviderAccountLogin', async (_event, request: LlmProviderAccountLoginFinishRequest) => {
    const result = await providerConnectionService.finishProviderAccountLogin(request);
    if (result.connected) {
      context.applyCurrentLlmConfig();
      await broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:logoutProviderAccount', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context.applyCurrentLlmConfig();
    await broadcastCatalog(providerId);
    return result;
  });

  ipcMain.handle('settings:get', async () => {
    const paths = appPathService.getRuntimePaths();
    return withEffectiveAgentModelOptions(settingsService.getAll({
      userRdxRoot: paths.userRdxRoot,
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

  ipcMain.handle('settings:getProviderCatalog', async () => {
    return settingsService.getProviderCatalog();
  });

  ipcMain.handle('settings:getEffectiveModel', async (_event, agentId: string) => {
    const settings = settingsService.getAll();
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
    if (!route?.providerId || !route.modelId) {
      return null;
    }
    await loadProviderSurface(route.providerId);
    return resolveEffectiveModel(route.providerId, route.modelId, settings);
  });

  ipcMain.handle('settings:getEffectiveCatalog', async (_event, providerId: string) => {
    await loadProviderSurface(providerId);
    return resolveEffectiveCatalog(providerId, settingsService.getAll());
  });

  ipcMain.handle('settings:getProviderSecret', async (_event, providerId: string) => {
    const paths = appPathService.getRuntimePaths();
    return settingsService.getProviderSecret(providerId, paths.userRdxRoot);
  });

  ipcMain.handle('settings:importAgentManifest', async (_event, filePath: string) => {
    const paths = appPathService.getRuntimePaths();
    await agentManifestService.importFile(paths, filePath);
    return withEffectiveAgentModelOptions(settingsService.getAll(paths));
  });

  ipcMain.handle('settings:saveAgentDefinition', async (_event, request: AgentDefinitionSaveRequest) => {
    return settingsService.saveAgentDefinition(request);
  });

  ipcMain.handle('settings:getAgentDefinitionCommit', async (_event, agentId: string) => {
    return settingsService.getAgentDefinitionCommit(agentId);
  });

  ipcMain.handle('settings:saveProviderDefinition', async (_event, request: ProviderDefinitionSaveRequest) => {
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

  ipcMain.handle('settings:getProviderDefinitionCommit', async (_event, providerId: string) => {
    const commit = await settingsService.getProviderDefinitionCommit(providerId);
    if (!commit) return null;
    await loadProviderSurface(providerId);
    const snapshot = resolveEffectiveCatalog(providerId, settingsService.getAll());
    const catalogRevision = snapshot?.catalogRevision ?? null;
    settingsService.setProviderDefinitionCatalogRevision(providerId, catalogRevision);
    return { ...commit, catalogRevision };
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    const patch = settings as AppSettingsPatch;
    const previousSettings = settingsService.getAll();
    const nextSettings = settingsService.setAll(patch, appPathService.getRuntimePaths());
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
}
