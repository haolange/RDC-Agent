import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { useAppSettingsStore } from './appSettingsStore';
import type { SettingsPatchOp, SettingsPatchResult } from '@shared/types/settings';

const DEFAULT_SETTINGS = createDefaultAppSettings();

function deferredPatches() {
  const calls: Array<{ ops: SettingsPatchOp[]; resolve: (result: SettingsPatchResult) => void; reject: (error: Error) => void }> = [];
  const patch = vi.fn((ops: SettingsPatchOp[]) => new Promise<SettingsPatchResult>((resolve, reject) => {
    calls.push({ ops, resolve, reject });
  }));
  vi.stubGlobal('window', { electronAPI: { settings: { patch } } });
  return calls;
}

describe('optimistic settings patches', () => {
  afterEach(() => {
    useAppSettingsStore.setState({ settings: DEFAULT_SETTINGS, contextBreakdownPreference: null, hydrated: false });
    vi.unstubAllGlobals();
  });

  it('rolls back only the failed intent and keeps a later one in the same section', async () => {
    const calls = deferredPatches();
    const store = useAppSettingsStore;
    store.getState().hydrate(DEFAULT_SETTINGS, 'dark');
    const theme = store.getState().setTheme('light');
    const language = store.getState().setLanguage('en');
    expect(store.getState().settings.appearance).toMatchObject({ theme: 'light', language: 'en' });

    calls[0]!.reject(new Error('disk full'));
    await expect(theme).rejects.toThrow('disk full');
    expect(store.getState().settings.appearance).toMatchObject({ theme: DEFAULT_SETTINGS.appearance.theme, language: 'en' });

    calls[1]!.resolve({ revision: 2, changed: { appearance: { ...DEFAULT_SETTINGS.appearance, language: 'en' } } });
    await language;
    expect(store.getState().settings.appearance).toMatchObject({ theme: DEFAULT_SETTINGS.appearance.theme, language: 'en' });
  });

  it('keeps two Agents edited before the first save returns', async () => {
    const calls = deferredPatches();
    const store = useAppSettingsStore;
    store.getState().hydrate(DEFAULT_SETTINGS, 'dark');
    const first = store.getState().patchSettings([{ op: 'agentModels.setAgentField', agentId: 'debugger', field: 'model', value: 'ollama:local-model' }]);
    const second = store.getState().patchSettings([{ op: 'agentModels.setAgentField', agentId: 'analyzer', field: 'model', value: 'ollama:other-model' }]);

    calls[0]!.resolve({ revision: 2, changed: { agentModels: { byAgent: { debugger: { model: 'ollama:local-model' } } } } });
    await first;
    expect(store.getState().settings.agentModels.byAgent).toEqual({
      debugger: { model: 'ollama:local-model' }, analyzer: { model: 'ollama:other-model' },
    });
    calls[1]!.resolve({ revision: 3, changed: { agentModels: { byAgent: { analyzer: { model: 'ollama:other-model' } } } } });
    await second;
    expect(store.getState().settings.agentModels.byAgent).toEqual({
      debugger: { model: 'ollama:local-model' }, analyzer: { model: 'ollama:other-model' },
    });
  });

  it('adopts the value main stored, not the optimistic one', async () => {
    const calls = deferredPatches();
    const store = useAppSettingsStore;
    store.getState().hydrate(DEFAULT_SETTINGS, 'dark');
    const saving = store.getState().patchSettings([{ op: 'layout', value: { leftSidebar: { width: 5 } } }]);
    expect(store.getState().settings.layout.leftSidebar.width).toBe(5);
    const layout = { ...DEFAULT_SETTINGS.layout, leftSidebar: { ...DEFAULT_SETTINGS.layout.leftSidebar, width: 240 } };
    calls[0]!.resolve({ revision: 2, changed: { layout } });
    await expect(saving).resolves.toMatchObject({ layout });
  });
});
