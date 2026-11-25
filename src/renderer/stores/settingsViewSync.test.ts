import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { useAppSettingsStore } from './appSettingsStore';
import { useProjectStore } from './projectStore';
import type { SettingsPatchResult, SettingsView } from '@shared/types/settings';

const DEFAULT_SETTINGS = createDefaultAppSettings();
const CATALOG = { categories: [], protocols: [], providers: [] };
// The store is one per renderer and revisions only grow, so each test starts above the last.
let base = 0;
const view = (revision: number, overrides: Partial<SettingsView> = {}): SettingsView => ({
  ...DEFAULT_SETTINGS,
  revision: base + revision,
  llm: { connections: [], agentRoutes: [] },
  agents: { ...DEFAULT_SETTINGS.agents, projectId: 'project-a' },
  ...overrides,
});
const store = () => useAppSettingsStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings view reads', () => {
  let get: ReturnType<typeof vi.fn>;
  let patch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    base += 100;
    get = vi.fn(async () => view(5));
    patch = vi.fn();
    vi.stubGlobal('window', { electronAPI: { settings: { get, patch, getProviderCatalog: async () => CATALOG } } });
    store().hydrate(view(1), CATALOG, 'dark');
    useProjectStore.setState({ currentProject: null });
  });
  afterEach(() => {
    useAppSettingsStore.setState({ settings: DEFAULT_SETTINGS, providerCatalog: null, hydrated: false });
    useProjectStore.setState({ currentProject: null });
    vi.unstubAllGlobals();
  });

  it('does not read again for the project it already holds, and reads once for another', async () => {
    await store().reloadSettings();
    await store().reloadSettings('project-a');
    useProjectStore.setState({ currentProject: { projectId: 'project-a' } as never });
    await store().reloadSettings();
    expect(get).not.toHaveBeenCalled();

    get.mockResolvedValueOnce(view(2, { agents: { ...DEFAULT_SETTINGS.agents, projectId: 'project-b' } }));
    await Promise.all([store().reloadSettings('project-b'), store().reloadSettings('project-b')]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reads for a provider change made elsewhere, not for sections the renderer writes itself', async () => {
    store().adoptSettingsChange({ revision: base + 2, sections: ['appearance'] });
    store().adoptSettingsChange({ revision: base + 3, sections: ['layout'] });
    store().adoptSettingsChange({ revision: base + 4, sections: ['agentRuntime'] });
    await settle();
    expect(get).not.toHaveBeenCalled();
    store().adoptSettingsChange({ revision: base + 5, sections: ['providers'] });
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    store().adoptSettingsChange({ revision: base + 5, sections: ['providers'] });
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('needs no read for the change its own patch made, and keeps the patch over an older read', async () => {
    let answer!: (result: SettingsPatchResult) => void;
    patch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const saving = store().patchSettings([{ op: 'agentModels.setDefault', field: 'model', value: 'p:m' }]);
    store().adoptSettingsChange({ revision: base + 2, sections: ['agentModels'] });
    await settle();
    expect(get).not.toHaveBeenCalled();
    answer({ revision: base + 2, changed: { agentModels: { default: { model: 'p:m' } } } });
    await saving;
    await settle();
    expect(get).not.toHaveBeenCalled();

    store().replaceSettings(view(1));
    expect(store().settings.agentModels.default).toEqual({ model: 'p:m' });
  });

  it('reads after its own write settles when another writer changed providers meanwhile', async () => {
    let answer!: (result: SettingsPatchResult) => void;
    patch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const saving = store().patchSettings([{ op: 'appearance', value: { theme: 'light' } }]);
    get.mockResolvedValueOnce(view(5, { appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light' } }));
    store().adoptSettingsChange({ revision: base + 2, sections: ['providers'] });
    store().adoptSettingsChange({ revision: base + 3, sections: ['appearance'] });
    await settle();
    expect(get).not.toHaveBeenCalled();
    answer({ revision: base + 3, changed: { appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light' } } });
    await saving;
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    expect(store().settings.appearance.theme).toBe('light');
  });
});
