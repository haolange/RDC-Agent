import { ipcMain } from 'electron';
import type {
  AppSettingsPatch,
  LlmModelCapabilityProbeRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderDraftRequest,
  LlmProviderId,
} from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from '../settings/AgentManifestService';
import { providerConnectionService } from '../settings/ProviderConnectionService';
import { settingsService } from '../settings/SettingsService';
import { resolveEffectiveCatalog, resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { effectiveCatalogService } from '../settings/EffectiveCatalogService';
import { providerCapabilityProbeService } from '../settings/ProviderCapabilityProbeService';
import { reprojectProviderProtocolChange } from '../settings/ProviderProtocolSwitchService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerSettingsLlmHandlers(context: WorkbenchIpcContext): void {
  effectiveCatalogService.setDiscoveryLoaderResolver((request) => (
    providerConnectionService.createEffectiveCatalogDiscoveryLoader(request)
  ));
  effectiveCatalogService.subscribe((snapshot) => {
    context.broadcastToRenderer('llm:effectiveCatalogChanged', snapshot);
  });

  const broadcastCatalog = (providerId: string): void => {
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
    const previousProvider = settingsService.getAll().llm.providers.find((entry) => entry.id === request.providerId);
    const result = await providerConnectionService.connectProvider(request);
    if (result.success) {
      context.applyCurrentLlmConfig();
      if (previousProvider && result.provider && previousProvider.protocol !== result.provider.protocol) {
        try {
          const snapshot = resolveEffectiveCatalog(request.providerId, settingsService.getAll());
          if (!snapshot) throw new Error('Protocol change produced no EffectiveCatalog snapshot.');
          await reprojectProviderProtocolChange({
            providerId: request.providerId,
            previousProtocol: previousProvider.protocol,
            settings: settingsService.getAll(),
            snapshot,
          });
        } catch (error) {
          return {
            ...result,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:refreshProviderModels', async (_event, providerId: LlmProviderId) => {
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      broadcastCatalog(providerId);
    }
    return result;
  });

  ipcMain.handle('llm:disconnectProvider', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
      broadcastCatalog(providerId);
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
      broadcastCatalog(request.providerId);
    }
    return result;
  });

  ipcMain.handle('llm:logoutProviderAccount', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context.applyCurrentLlmConfig();
    broadcastCatalog(providerId);
    return result;
  });

  ipcMain.handle('settings:get', async () => {
    const paths = appPathService.getRuntimePaths();
    return settingsService.getAll({
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
    });
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
    return resolveEffectiveModel(route.providerId, route.modelId, settings);
  });

  ipcMain.handle('settings:getEffectiveCatalog', async (_event, providerId: string) => {
    return resolveEffectiveCatalog(providerId, settingsService.getAll());
  });

  ipcMain.handle('settings:getProviderSecret', async (_event, providerId: string) => {
    const paths = appPathService.getRuntimePaths();
    return settingsService.getProviderSecret(providerId, paths.userRdxRoot);
  });

  ipcMain.handle('settings:importAgentManifest', async (_event, filePath: string) => {
    const paths = appPathService.getRuntimePaths();
    agentManifestService.importFile(paths, filePath);
    return settingsService.getAll(paths);
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    const previousSettings = settingsService.getAll();
    const nextSettings = settingsService.setAll(settings as AppSettingsPatch, appPathService.getRuntimePaths());
    await storageAdapter.initializeWorkspace();
    await context.initializeIpcState();
    context.applyCurrentLlmConfig();
    for (const provider of nextSettings.llm.providers) {
      const previous = previousSettings.llm.providers.find((entry) => entry.id === provider.id);
      if (previous && previous.protocol !== provider.protocol) {
        const discovery = await providerConnectionService.refreshProviderModels(provider.id);
        if (!discovery.success) {
          throw new Error(
            `Protocol change to ${provider.protocol} was saved, but reprojection discovery failed: ${discovery.error ?? 'unknown error'}`,
          );
        }
        const snapshot = resolveEffectiveCatalog(provider.id, settingsService.getAll());
        if (!snapshot) throw new Error('Protocol change produced no EffectiveCatalog snapshot.');
        await reprojectProviderProtocolChange({
          providerId: provider.id,
          previousProtocol: previous.protocol,
          settings: settingsService.getAll(),
          snapshot,
        });
      }
    }
    const settledSettings = settingsService.getAll();
    for (const provider of settledSettings.llm.providers) broadcastCatalog(provider.id);
    return settledSettings;
  });
}
