import { describe, expect, it, vi } from 'vitest';
import { registerSettingsLlmHandlers } from './settingsLlmHandlers';
import type { SettingsPatchResult } from '@shared/types/settings';
import type { WorkbenchIpcContext } from './workbenchContext';


const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  settings: {
    appearance: { theme: 'dark', language: 'zh-CN' },
    llm: { providers: [{ id: 'deepseek', catalogOwnership: 'provider-managed' }], agentRoutes: [] },
    agents: { definitions: [], modelOptions: [] },
  },
  catalog: { providerId: 'deepseek', models: [{ modelId: 'deepseek-v4-flash' }] },
  modelOption: { canonicalId: 'deepseek:deepseek-v4-flash', status: 'ready' },
  load: vi.fn(async () => undefined),
  applyIcon: vi.fn(),
  applyBackgrounds: vi.fn(),
  refreshMenu: vi.fn(),
  log: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => fixture.handlers.set(name, fn) },
}));
vi.mock('../runtime/AppPathService', () => ({ appPathService: { getRuntimePaths: () => ({}) } }));
vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: {
  onChanged: () => () => undefined,
  snapshot: () => ({ revision: 1, user: structuredClone(fixture.settings) }),
  providerConnections: {
    get: (providerId: string) => fixture.settings.llm.providers.find((entry) => entry.id === providerId),
    list: () => structuredClone(fixture.settings.llm.providers),
  },
  rendererSettingsDto: () => structuredClone(fixture.settings),
  update: (ops: Array<{ op: string; value: Record<string, unknown> }>) => {
    const before = JSON.stringify(fixture.settings.appearance);
    for (const op of ops) fixture.settings.appearance = { ...fixture.settings.appearance, ...op.value };
    const changed = JSON.stringify(fixture.settings.appearance) === before ? {} : { appearance: structuredClone(fixture.settings.appearance) };
    return { revision: 2, changed };
  },
} }));
vi.mock('../settings/agent-manifests/AgentManifestService', () => ({ agentManifestService: {
  modelOptionCatalogProviderIds: () => ['deepseek'],
  projectEffectiveModelOptions: (agents: object, _providers: unknown, _routes: unknown, catalogs: unknown[]) => ({
    ...agents, modelOptions: catalogs.length ? [fixture.modelOption] : [],
  }),
} }));
vi.mock('../settings/provider-catalog/EffectiveModelResolver', () => ({ resolveEffectiveCatalog: () => fixture.catalog, resolveEffectiveModel: vi.fn() }));
vi.mock('../settings/provider-catalog/EffectiveCatalogService', () => ({ effectiveCatalogService: { setConfigurationValidator: vi.fn(), setDiscoveryLoaderResolver: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../provider-catalog/ProviderCatalogRegistry', () => ({ loadProviderSurface: fixture.load }));
vi.mock('../settings/provider-catalog/compiledAgentRoutes', () => ({ resolveCompiledRouteForAgent: vi.fn() }));
vi.mock('../settings/settings-core/resolveRegisteredProjectRoot', () => ({ tryCurrentProjectRoot: vi.fn() }));
vi.mock('../settings/provider-auth/ProviderConnectionService', () => ({ providerConnectionService: {} }));
vi.mock('../agent-runtime/capabilities/ProviderCapabilityProbeService', () => ({ providerCapabilityProbeService: {} }));
vi.mock('../settings/settings-core/ModelsOverrideService', () => ({ modelsOverrideService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: fixture.log } }));
vi.mock('../runtime/ShellResolver', () => ({ shellResolver: {}, formatShellInterpreterLabel: vi.fn() }));
vi.mock('../window/applicationMenu', () => ({ refreshApplicationMenu: fixture.refreshMenu }));
vi.mock('../window/productIcon', () => ({ applyProductIcon: fixture.applyIcon }));
vi.mock('../window/appearanceChrome', () => ({ applyWindowBackgrounds: fixture.applyBackgrounds }));

describe('settings:patch response', () => {
  it('answers with what changed only and refreshes native chrome only for a theme change', async () => {
    const broadcastToRenderer = vi.fn();
    const applyCurrentLlmConfig = vi.fn();
    registerSettingsLlmHandlers({ broadcastToRenderer, applyCurrentLlmConfig } as unknown as WorkbenchIpcContext);
    const handle = fixture.handlers.get('settings:patch')!;
    for (const theme of ['light', 'dark']) {
      const result = await handle({}, [{ op: 'appearance', value: { theme } }]) as SettingsPatchResult;
      expect(result.changed.appearance?.theme).toBe(theme);
      expect(Object.keys(result.changed)).toEqual(['appearance']);
    }
    expect(fixture.applyIcon).toHaveBeenCalledTimes(2);
    await handle({}, [{ op: 'appearance', value: { theme: 'dark' } }]);
    expect(fixture.applyIcon).toHaveBeenCalledTimes(2);
    expect(fixture.load).not.toHaveBeenCalled();
    expect(broadcastToRenderer).not.toHaveBeenCalled();
    expect(applyCurrentLlmConfig).not.toHaveBeenCalled();
  });

  it('rejects provider state and whole-section agent models', async () => {
    registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
    const handle = fixture.handlers.get('settings:patch')!;
    await expect(Promise.resolve().then(() => handle({}, [{ op: 'llm', value: { providers: [] } }]))).rejects.toThrow();
    await expect(Promise.resolve().then(() => handle({}, [{ op: 'agentModels', value: { default: {}, byAgent: {} } }]))).rejects.toThrow();
    await expect(Promise.resolve().then(() => handle({}, { appearance: { theme: 'light' } }))).rejects.toThrow();
  });
});

it('refreshes native menus only after a committed language change', async () => {
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const handle = fixture.handlers.get('settings:patch')!;
  for (const language of ['en', 'zh-CN']) {
    const result = await handle({}, [{ op: 'appearance', value: { language } }]) as SettingsPatchResult;
    expect(result.changed.appearance?.language).toBe(language);
  }
  expect(fixture.refreshMenu).toHaveBeenCalledTimes(2);
  await handle({}, [{ op: 'appearance', value: { language: 'zh-CN' } }]);
  expect(fixture.refreshMenu).toHaveBeenCalledTimes(2);
});

it('saves the context details preference without refreshing native chrome', async () => {
  fixture.applyIcon.mockClear();
  fixture.applyBackgrounds.mockClear();
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const result = await fixture.handlers.get('settings:patch')!({}, [
    { op: 'appearance', value: { contextBreakdownExpanded: true } },
  ]) as SettingsPatchResult;
  expect(result.changed.appearance?.contextBreakdownExpanded).toBe(true);
  expect(fixture.applyIcon).not.toHaveBeenCalled();
  expect(fixture.applyBackgrounds).not.toHaveBeenCalled();
});

it('returns the committed change when a native notification fails', async () => {
  fixture.applyIcon.mockImplementationOnce(() => { throw new Error('native observer failed'); });
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const result = await fixture.handlers.get('settings:patch')!({}, [{ op: 'appearance', value: { theme: 'light' } }]) as SettingsPatchResult;
  expect(result.changed.appearance?.theme).toBe('light');
  expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ raw: { code: 'SETTINGS_COMMITTED_NOTIFICATION_FAILED' } }));
});
