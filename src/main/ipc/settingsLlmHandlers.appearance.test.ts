import { describe, expect, it, vi } from 'vitest';
import { registerSettingsLlmHandlers } from './settingsLlmHandlers';
import type { AppSettings } from '@shared/types/settings';
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
  update: (patch: { appearance: { theme: string } }) => {
    fixture.settings.appearance = { ...fixture.settings.appearance, ...patch.appearance };
    return { revision: 2, user: structuredClone(fixture.settings) };
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
vi.mock('../settings/provider-catalog/ProviderCapabilityProbeService', () => ({ providerCapabilityProbeService: {} }));
vi.mock('../settings/settings-core/ModelsOverrideService', () => ({ modelsOverrideService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: fixture.log } }));
vi.mock('../runtime/ShellResolver', () => ({ shellResolver: {}, formatShellInterpreterLabel: vi.fn() }));
vi.mock('../window/applicationMenu', () => ({ refreshApplicationMenu: fixture.refreshMenu }));
vi.mock('../window/productIcon', () => ({ applyProductIcon: fixture.applyIcon }));
vi.mock('../window/appearanceChrome', () => ({ applyWindowBackgrounds: fixture.applyBackgrounds }));

describe('appearance settings response', () => {
  it('keeps executable Agent choices after saving appearance without changing providers', async () => {
    const broadcastToRenderer = vi.fn();
    const applyCurrentLlmConfig = vi.fn();
    registerSettingsLlmHandlers({ broadcastToRenderer, applyCurrentLlmConfig } as unknown as WorkbenchIpcContext);
    const handle = fixture.handlers.get('settings:set')!;
    for (const theme of ['light', 'dark']) {
      const result = await handle({}, { appearance: { theme } }) as AppSettings;
      expect(result.appearance.theme).toBe(theme);
      expect(result.agents.modelOptions).toEqual([fixture.modelOption]);
    }
    expect(fixture.applyIcon).toHaveBeenCalledTimes(2);
    await handle({}, {});
    expect(fixture.applyIcon).toHaveBeenCalledTimes(2);
    expect(fixture.load).toHaveBeenCalledWith('deepseek');
    expect(broadcastToRenderer).not.toHaveBeenCalled();
    expect(applyCurrentLlmConfig).not.toHaveBeenCalled();
  });
});

it('refreshes native menus only after a committed language change', async () => {
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const handle = fixture.handlers.get('settings:set')!;
  for (const language of ['en', 'zh-CN']) {
    const result = await handle({}, { appearance: { language } }) as AppSettings;
    expect(result.appearance.language).toBe(language);
  }
  expect(fixture.refreshMenu).toHaveBeenCalledTimes(2);
  await handle({}, { appearance: { language: 'zh-CN' } });
  expect(fixture.refreshMenu).toHaveBeenCalledTimes(2);
});

it('saves the context details preference without refreshing native chrome', async () => {
  fixture.applyIcon.mockClear();
  fixture.applyBackgrounds.mockClear();
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const result = await fixture.handlers.get('settings:set')!({}, {
    appearance: { contextBreakdownExpanded: true },
  }) as AppSettings;
  expect(result.appearance.contextBreakdownExpanded).toBe(true);
  expect(fixture.applyIcon).not.toHaveBeenCalled();
  expect(fixture.applyBackgrounds).not.toHaveBeenCalled();
});

it('returns committed settings when a native notification fails', async () => {
  fixture.applyIcon.mockImplementationOnce(() => { throw new Error('native observer failed'); });
  registerSettingsLlmHandlers({ broadcastToRenderer: vi.fn(), applyCurrentLlmConfig: vi.fn() } as unknown as WorkbenchIpcContext);
  const result = await fixture.handlers.get('settings:set')!({}, { appearance: { theme: 'light' } }) as AppSettings;
  expect(result.appearance.theme).toBe('light');
  expect(fixture.log).toHaveBeenCalledWith(expect.objectContaining({ raw: { code: 'SETTINGS_COMMITTED_NOTIFICATION_FAILED' } }));
});
