import { ipcMain } from 'electron';
import type {
  AppSettingsPatch,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderDraftRequest,
  LlmProviderId,
} from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';
import { llmAdapter } from '../settings/LLMAdapter';
import { providerConnectionService } from '../settings/ProviderConnectionService';
import { settingsService } from '../settings/SettingsService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerSettingsLlmHandlers(context: WorkbenchIpcContext): void {
  ipcMain.handle('llm:configure', async (_event, config: unknown) => {
    llmAdapter.configure(config as any);
    return;
  });

  ipcMain.handle('llm:testConnection', async (_event, provider: string) => {
    return llmAdapter.testConnection(provider);
  });

  ipcMain.handle('llm:getAvailableModels', async (_event, provider: string) => {
    return llmAdapter.getAvailableModels(provider);
  });

  ipcMain.handle('llm:testProviderDraft', async (_event, request: LlmProviderDraftRequest) => {
    return providerConnectionService.testProviderDraft(request);
  });

  ipcMain.handle('llm:connectProvider', async (_event, request: LlmProviderDraftRequest) => {
    const result = await providerConnectionService.connectProvider(request);
    if (result.success) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:refreshProviderModels', async (_event, providerId: LlmProviderId) => {
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:disconnectProvider', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:startProviderAccountLogin', async (_event, providerId: LlmProviderId) => {
    return providerConnectionService.startProviderAccountLogin(providerId);
  });

  ipcMain.handle('llm:getProviderAccountStatus', async (_event, providerId: LlmProviderId) => {
    return providerConnectionService.getProviderAccountStatus(providerId);
  });

  ipcMain.handle('llm:finishProviderAccountLogin', async (_event, request: LlmProviderAccountLoginFinishRequest) => {
    const result = await providerConnectionService.finishProviderAccountLogin(request);
    if (result.connected) {
      context.applyCurrentLlmConfig();
    }
    return result;
  });

  ipcMain.handle('llm:logoutProviderAccount', async (_event, providerId: LlmProviderId) => {
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context.applyCurrentLlmConfig();
    return result;
  });

  ipcMain.handle('settings:get', async () => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getAll({
      workspaceRoot: paths.workspaceRoot,
      defaultWorkspaceRoot: paths.defaultWorkspaceRoot,
      settingsPath: paths.settingsPath,
      logsPath: paths.logsPath,
      logPath: paths.logPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      migrationOrphansPath: paths.migrationOrphansPath,
      profilesPath: paths.profilesPath,
      policiesPath: paths.policiesPath,
      secretsPath: paths.secretsPath,
      migrationReportsPath: paths.migrationReportsPath,
    });
  });

  ipcMain.handle('settings:getProviderSecret', async (_event, providerId: string) => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getProviderSecret(providerId, paths.workspaceRoot);
  });

  ipcMain.handle('settings:set', async (_event, settings: unknown) => {
    const nextSettings = settingsService.setAll(settings as AppSettingsPatch, appPathService.getWorkspacePaths());
    storageAdapter.setWorkspaceRoot(nextSettings.workspace.rootPath);
    await storageAdapter.initializeWorkspace();
    await context.initializeIpcState();
    context.applyCurrentLlmConfig();
    return nextSettings;
  });
}
