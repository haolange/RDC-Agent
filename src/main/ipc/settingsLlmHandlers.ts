import { ipcMain } from 'electron';
import { providerAccountAuthService } from '../settings/provider-auth/ProviderAccountAuthService';
import { refreshApplicationMenu } from '../window/applicationMenu';
import { confirmResourceTrust } from '../window/trustConfirmation';
import { appPathService } from '../runtime/AppPathService';
import { agentManifestService } from '../settings/agent-manifests/AgentManifestService';
import { resolveCompiledRouteForAgent } from '../settings/provider-catalog/compiledAgentRoutes';
import { tryCurrentProjectRoot } from '../settings/settings-core/resolveRegisteredProjectRoot';
import { providerConnectionService } from '../settings/provider-auth/ProviderConnectionService';
import { settingsService } from '../settings/settings-core/SettingsService';
import { buildEffectiveCatalogRequest, resolveEffectiveCatalog, resolveEffectiveModel } from '../settings/provider-catalog/EffectiveModelResolver';
import { effectiveCatalogService } from '../settings/provider-catalog/EffectiveCatalogService';
import { CatalogChangePublisher } from '../settings/provider-catalog/catalogChangePublisher';
import { providerCapabilityProbeService } from '../settings/provider-catalog/ProviderCapabilityProbeService';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { applyProductIcon } from '../window/productIcon';
import { applyWindowBackgrounds } from '../window/appearanceChrome';
import { formatShellInterpreterLabel, shellResolver } from '../runtime/ShellResolver';
import { modelsOverrideService } from '../settings/settings-core/ModelsOverrideService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  SettingsGetEffectiveCatalogArgsSchema,
  SettingsGetResolvedShellArgsSchema,
  SettingsHasProviderSecretArgsSchema,
  SettingsImportAgentManifestArgsSchema,
  SettingsProviderIdArgsSchema,
  SettingsPatchArgsSchema,
  SettingsAgentIdArgsSchema,
} from './validation/ipcSchemas';
import {
  LlmModelCapabilityProbeArgsSchema,
  LlmProviderAccountLoginFinishArgsSchema,
  LlmProviderAccountLoginStartArgsSchema,
  LlmProviderDraftArgsSchema,
  LlmProviderIdArgsSchema,
  LlmRefreshProviderModelsArgsSchema,
  SettingsGetAgentDefinitionCommitArgsSchema,
  SettingsAgentSourcePathArgsSchema,
  SettingsAgentOverrideFileArgsSchema,
  SettingsSaveAgentDefinitionArgsSchema,
  SettingsSaveProviderDefinitionArgsSchema,
  SettingsGetModelsOverrideArgsSchema,
  SettingsSetModelsOverrideArgsSchema,
} from './validation/settingsLlmSchemas';
import { registerProviderProbeHandlers } from './providerProbeHandlers';
import type { ModelsOverride } from '@shared/provider-catalog/modelsOverrideSchema';
import type { WorkbenchIpcContext } from './workbenchContext';
import type { AgentDefinitionSaveRequest } from '@shared/types/agentManifest';
import type {
  AppSettings,
  LlmModelCapabilityProbeRequest,
  LlmProviderAccountLoginStartRequest,
  LlmProviderAccountLoginFinishRequest,
  LlmProviderDraftRequest,
  LlmProviderId,
  ProviderDefinitionSaveRequest,
  SettingsPatchOp,
} from '@shared/types/settings';

/** Observers of committed settings may fail; the saved file stays authoritative. */
async function notifyCommitted(notify: () => unknown): Promise<void> {
  try { await notify(); } catch (error) {
    runtimeLogService.log({ scope: 'app', namespace: 'system', severity: 'error',
      title: 'Settings committed; observer update failed',
      summary: 'The saved settings remain authoritative.',
      detail: error instanceof Error ? error.message : String(error),
      raw: { code: 'SETTINGS_COMMITTED_NOTIFICATION_FAILED' } });
  }
}

export function registerSettingsLlmHandlers(context: WorkbenchIpcContext): void {
  registerProviderProbeHandlers(context);
  settingsService.onChanged((change) => context.broadcastToRenderer('settings:changed', change));
  effectiveCatalogService.setConfigurationValidator((request) => {
    const provider = settingsService.providerConnections.get(request.providerId);
    return !!provider && buildEffectiveCatalogRequest(provider).configurationRevision === request.configurationRevision;
  });
  effectiveCatalogService.setDiscoveryLoaderResolver((request) => (
    providerConnectionService.createEffectiveCatalogDiscoveryLoader(request)
  ));
  const catalogChanges = new CatalogChangePublisher((change) => context.broadcastToRenderer('llm:effectiveCatalogChanged', change));
  effectiveCatalogService.subscribe((snapshot) => catalogChanges.publish(snapshot));

  const withEffectiveAgentModelOptions = async (settings: AppSettings): Promise<AppSettings> => {
    const catalogProviderIds = agentManifestService.modelOptionCatalogProviderIds(
      settings.llm.providers,
      settings.llm.agentRoutes,
    );
    await Promise.all(catalogProviderIds.map((providerId) => loadProviderSurface(providerId)));
    const catalogs = settings.llm.providers.flatMap((provider) => {
      if (!catalogProviderIds.includes(provider.id)) return [];
      const snapshot = resolveEffectiveCatalog(provider.id, settingsService.providerConnections);
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

  /** The renderer's settings view with the executable Agent model options resolved against live catalogs. */
  const rendererSettings = (): Promise<AppSettings> => withEffectiveAgentModelOptions(settingsService.rendererSettingsDto());

  const broadcastCatalog = async (providerId: string): Promise<void> => {
    await loadProviderSurface(providerId);
    const snapshot = resolveEffectiveCatalog(providerId, settingsService.providerConnections);
    if (snapshot) effectiveCatalogService.announce(snapshot);
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
    await loadProviderSurface(request.providerId);
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
    const [providerId, scope] = parseIpcArgs(LlmRefreshProviderModelsArgsSchema, rawArgs, {
      label: 'llm:refreshProviderModels',
      maxBytes: 4 * 1024,
    });
    const result = await providerConnectionService.refreshProviderModels(providerId, scope);
    if (result.success) {
      context.applyCurrentLlmConfig();
      // Shared discovery published the versioned catalog; refresh agent option projection.
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

  ipcMain.handle('llm:cancelProviderAccountLogin', (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(LlmProviderIdArgsSchema, rawArgs, {
      label: 'llm:cancelProviderAccountLogin', maxBytes: 1024,
    });
    providerAccountAuthService.cancelLogin(providerId);
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
    // Opening Settings is where edits made outside the app (secrets, Agent files, trust) are picked up.
    settingsService.revalidateExternalInputs();
    return rendererSettings();
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
      const route = resolveCompiledRouteForAgent(agentId, tryCurrentProjectRoot());
      if (!route?.providerId || !route.modelId) return null;
      await loadProviderSurface(route.providerId);
      return resolveEffectiveModel(route.providerId, route.modelId, settingsService.providerConnections);
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
    const snapshot = resolveEffectiveCatalog(
      providerId,
      settingsService.providerConnections,
      undefined,
      accountId ?? undefined,
    );
    if (snapshot) catalogChanges.delivered(snapshot);
    return snapshot;
  });

  ipcMain.handle('settings:hasProviderSecret', async (_event, ...rawArgs: unknown[]) => {
    const [providerId] = parseIpcArgs(SettingsHasProviderSecretArgsSchema, rawArgs, {
      label: 'settings:hasProviderSecret',
      maxBytes: 4 * 1024,
    });
    return settingsService.hasProviderSecret(providerId);
  });

  ipcMain.handle('settings:importAgentManifest', async (_event, ...rawArgs: unknown[]) => {
    const [filePath] = parseIpcArgs(SettingsImportAgentManifestArgsSchema, rawArgs, {
      label: 'settings:importAgentManifest',
      maxBytes: 8 * 1024,
    });
    await agentManifestService.importFile(appPathService.getRuntimePaths(), filePath);
    return rendererSettings();
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

  ipcMain.handle('settings:previewAgentModelMigration', async (_event, ...rawArgs: unknown[]) => {
    const [sourcePath] = parseIpcArgs(SettingsAgentSourcePathArgsSchema, rawArgs, {
      label: 'settings:previewAgentModelMigration',
      maxBytes: 8 * 1024,
    });
    return settingsService.previewAgentModelMigration(sourcePath);
  });

  ipcMain.handle('settings:applyAgentModelMigration', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsAgentOverrideFileArgsSchema, rawArgs, {
      label: 'settings:applyAgentModelMigration',
      maxBytes: 8 * 1024,
    });
    await settingsService.applyAgentModelMigration(request);
    await notifyCommitted(() => context.applyCurrentLlmConfig());
    return rendererSettings();
  });

  ipcMain.handle('settings:deleteAgentOverrideFile', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsAgentOverrideFileArgsSchema, rawArgs, {
      label: 'settings:deleteAgentOverrideFile',
      maxBytes: 8 * 1024,
    });
    await settingsService.deleteAgentOverrideFile(request);
    return rendererSettings();
  });

  ipcMain.handle('settings:previewProjectAgentTrust', async (_event, ...rawArgs: unknown[]) => {
    const [sourcePath] = parseIpcArgs(SettingsAgentSourcePathArgsSchema, rawArgs, {
      label: 'settings:previewProjectAgentTrust',
      maxBytes: 8 * 1024,
    });
    return settingsService.previewProjectAgentTrust(sourcePath);
  });

  ipcMain.handle('settings:trustProjectAgent', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsAgentOverrideFileArgsSchema, rawArgs, {
      label: 'settings:trustProjectAgent',
      maxBytes: 8 * 1024,
    });
    const preview = settingsService.previewProjectAgentTrust(request.sourcePath);
    if (!await confirmResourceTrust('agent', preview.agentId, preview.sourcePath)) {
      return rendererSettings();
    }
    settingsService.trustProjectAgent(request);
    await notifyCommitted(() => context.applyCurrentLlmConfig());
    return rendererSettings();
  });

  ipcMain.handle('settings:getAgentBuiltinComparison', async (_event, ...rawArgs: unknown[]) => {
    const [query] = parseIpcArgs(SettingsGetAgentDefinitionCommitArgsSchema, rawArgs, {
      label: 'settings:getAgentBuiltinComparison',
      maxBytes: 4 * 1024,
    });
    return settingsService.getAgentBuiltinComparison(query);
  });

  ipcMain.handle('settings:saveProviderDefinition', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(SettingsSaveProviderDefinitionArgsSchema, rawArgs, {
      label: 'settings:saveProviderDefinition',
      maxBytes: 2 * 1024 * 1024,
    }) as [ProviderDefinitionSaveRequest];
    const result = await settingsService.saveProviderDefinition(request);
    if (result.status !== 'committed' || !result.provider) return result;
    context.applyCurrentLlmConfig();
    await loadProviderSurface(result.provider.id);
    const snapshot = resolveEffectiveCatalog(result.provider.id, settingsService.providerConnections);
    const catalogRevision = snapshot?.catalogRevision ?? null;
    settingsService.setProviderDefinitionCatalogRevision(result.provider.id, catalogRevision);
    if (snapshot) effectiveCatalogService.announce(snapshot);
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
    const snapshot = resolveEffectiveCatalog(providerId, settingsService.providerConnections);
    const catalogRevision = snapshot?.catalogRevision ?? null;
    settingsService.setProviderDefinitionCatalogRevision(providerId, catalogRevision);
    return { ...commit, catalogRevision };
  });

  ipcMain.handle('settings:patch', async (_event, ...rawArgs: unknown[]) => {
    const [ops] = parseIpcArgs(SettingsPatchArgsSchema, rawArgs, {
      label: 'settings:patch',
      maxBytes: 1024 * 1024,
    }) as [SettingsPatchOp[]];
    const previousLanguage = settingsService.snapshot().user.appearance.language;
    const result = settingsService.update(ops);
    const { appearance, agentModels } = result.changed;
    if (appearance && ops.some((op) => op.op === 'appearance' && (op.value.theme !== undefined || op.value.chromeThemes !== undefined))) {
      await notifyCommitted(applyProductIcon);
      await notifyCommitted(applyWindowBackgrounds);
    }
    if (appearance && appearance.language !== previousLanguage) await notifyCommitted(refreshApplicationMenu);
    if (agentModels) await notifyCommitted(() => context.applyCurrentLlmConfig());
    return result;
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
