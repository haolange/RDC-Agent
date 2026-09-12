import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types/settings';
import type { WorkbenchIpcContext } from './workbenchContext';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  settings: {
    appearance: { theme: 'dark' },
    llm: { providers: [{ id: 'deepseek', catalogOwnership: 'provider-managed' }], agentRoutes: [] },
    agents: { definitions: [], modelOptions: [] },
  },
  catalog: { providerId: 'deepseek', models: [{ modelId: 'deepseek-v4-flash' }] },
  modelOption: { canonicalId: 'deepseek:deepseek-v4-flash', status: 'ready' },
  load: vi.fn(async () => undefined),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => fixture.handlers.set(name, fn) },
}));
vi.mock('../runtime/AppPathService', () => ({ appPathService: { getRuntimePaths: () => ({}) } }));
vi.mock('../settings/SettingsService', () => ({ settingsService: {
  getAll: () => structuredClone(fixture.settings),
  setAll: (patch: { appearance: { theme: string } }) => {
    fixture.settings.appearance = { ...fixture.settings.appearance, ...patch.appearance };
    return structuredClone(fixture.settings);
  },
} }));
vi.mock('../settings/AgentManifestService', () => ({ agentManifestService: {
  modelOptionCatalogProviderIds: () => ['deepseek'],
  projectEffectiveModelOptions: (agents: object, _providers: unknown, _routes: unknown, catalogs: unknown[]) => ({
    ...agents, modelOptions: catalogs.length ? [fixture.modelOption] : [],
  }),
} }));
vi.mock('../settings/EffectiveModelResolver', () => ({ resolveEffectiveCatalog: () => fixture.catalog, resolveEffectiveModel: vi.fn() }));
vi.mock('../settings/EffectiveCatalogService', () => ({ effectiveCatalogService: { setDiscoveryLoaderResolver: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../provider-catalog/ProviderCatalogRegistry', () => ({ loadProviderSurface: fixture.load }));
vi.mock('../settings/compiledAgentRoutes', () => ({ resolveCompiledRouteForAgent: vi.fn() }));
vi.mock('../settings/resolveRegisteredProjectRoot', () => ({ tryCurrentProjectRoot: vi.fn() }));
vi.mock('../settings/ProviderConnectionService', () => ({ providerConnectionService: {} }));
vi.mock('../settings/ProviderCapabilityProbeService', () => ({ providerCapabilityProbeService: {} }));
vi.mock('../settings/ModelsOverrideService', () => ({ modelsOverrideService: {} }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: {} }));
vi.mock('../runtime/ShellResolver', () => ({ shellResolver: {}, formatShellInterpreterLabel: vi.fn() }));

import { registerSettingsLlmHandlers } from './settingsLlmHandlers';

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
    expect(fixture.load).toHaveBeenCalledWith('deepseek');
    expect(broadcastToRenderer).not.toHaveBeenCalled();
    expect(applyCurrentLlmConfig).not.toHaveBeenCalled();
  });
});
