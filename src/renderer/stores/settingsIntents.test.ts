import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { providerConnectionState } from '@shared/utils/providerEntryView';
import { useAppSettingsStore } from './appSettingsStore';
import type {
  AppSettings,
  LlmProviderCatalogResponse,
  LlmProviderEntry,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  SettingsPatchOp,
  SettingsPatchResult,
  SettingsView,
} from '@shared/types/settings';

const DEFAULT_SETTINGS = createDefaultAppSettings();

/** `settings` as main sends it: the view at `revision`, and a catalog holding each provider's catalog facts. */
function viewOf(settings: AppSettings, revision = 1): [SettingsView, LlmProviderCatalogResponse] {
  const view: SettingsView = {
    ...settings,
    revision,
    llm: { connections: settings.llm.providers.map(providerConnectionState), agentRoutes: settings.llm.agentRoutes },
    agents: { ...settings.agents, projectId: null },
  };
  const providers = settings.llm.providers.map((provider) => ({
    ...provider,
    recommendedModels: provider.recommendedModels ?? [],
  }));
  return [view, { categories: [], protocols: [], providers }];
}

function deferredPatches() {
  const calls: Array<{
    ops: SettingsPatchOp[];
    resolve: (result: SettingsPatchResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const patch = vi.fn(
    (ops: SettingsPatchOp[]) =>
      new Promise<SettingsPatchResult>((resolve, reject) => {
        calls.push({ ops, resolve, reject });
      }),
  );
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
    store.getState().hydrate(...viewOf(DEFAULT_SETTINGS), 'dark');
    const theme = store.getState().setTheme('light');
    const language = store.getState().setLanguage('en');
    expect(store.getState().settings.appearance).toMatchObject({ theme: 'light', language: 'en' });

    calls[0]!.reject(new Error('disk full'));
    await expect(theme).rejects.toThrow('disk full');
    expect(store.getState().settings.appearance).toMatchObject({
      theme: DEFAULT_SETTINGS.appearance.theme,
      language: 'en',
    });

    calls[1]!.resolve({ revision: 2, changed: { appearance: { ...DEFAULT_SETTINGS.appearance, language: 'en' } } });
    await language;
    expect(store.getState().settings.appearance).toMatchObject({
      theme: DEFAULT_SETTINGS.appearance.theme,
      language: 'en',
    });
  });

  it('keeps two Agents edited before the first save returns', async () => {
    const calls = deferredPatches();
    const store = useAppSettingsStore;
    store.getState().hydrate(...viewOf(DEFAULT_SETTINGS), 'dark');
    const first = store
      .getState()
      .patchSettings([
        { op: 'agentModels.setAgentField', agentId: 'debugger', field: 'model', value: 'ollama:local-model' },
      ]);
    const second = store
      .getState()
      .patchSettings([
        { op: 'agentModels.setAgentField', agentId: 'analyzer', field: 'model', value: 'ollama:other-model' },
      ]);

    calls[0]!.resolve({
      revision: 2,
      changed: { agentModels: { byAgent: { debugger: { model: 'ollama:local-model' } } } },
    });
    await first;
    expect(store.getState().settings.agentModels.byAgent).toEqual({
      debugger: { model: 'ollama:local-model' },
      analyzer: { model: 'ollama:other-model' },
    });
    calls[1]!.resolve({
      revision: 3,
      changed: { agentModels: { byAgent: { analyzer: { model: 'ollama:other-model' } } } },
    });
    await second;
    expect(store.getState().settings.agentModels.byAgent).toEqual({
      debugger: { model: 'ollama:local-model' },
      analyzer: { model: 'ollama:other-model' },
    });
  });

  it('adopts the value main stored, not the optimistic one', async () => {
    const calls = deferredPatches();
    const store = useAppSettingsStore;
    store.getState().hydrate(...viewOf(DEFAULT_SETTINGS), 'dark');
    const saving = store.getState().patchSettings([{ op: 'layout', value: { leftSidebar: { width: 5 } } }]);
    expect(store.getState().settings.layout.leftSidebar.width).toBe(5);
    const layout = { ...DEFAULT_SETTINGS.layout, leftSidebar: { ...DEFAULT_SETTINGS.layout.leftSidebar, width: 240 } };
    calls[0]!.resolve({ revision: 2, changed: { layout } });
    await expect(saving).resolves.toMatchObject({ layout });
  });
});

describe('provider model choices on their revision lane', () => {
  afterEach(() => {
    useAppSettingsStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
    vi.unstubAllGlobals();
  });

  const provider = {
    id: 'lane-provider',
    activeAccountId: 'account',
    enabled: true,
    isConfigured: true,
    models: [
      { id: 'a', label: 'A', enabled: true },
      { id: 'b', label: 'B', enabled: true },
    ],
  } as LlmProviderEntry;
  const withChoices = (enabled: [boolean, boolean]): LlmProviderEntry => ({
    ...provider,
    models: provider.models.map((model, index) => ({ ...model, enabled: enabled[index]! })),
  });
  const enabledShown = () =>
    useAppSettingsStore.getState().settings.llm.providers[0]!.models.map((model) => model.enabled);

  function deferredSaves() {
    const calls: Array<{
      request: ProviderDefinitionSaveRequest;
      resolve: (result: ProviderDefinitionSaveResult) => void;
    }> = [];
    const saveProviderDefinition = vi.fn(
      (request: ProviderDefinitionSaveRequest) =>
        new Promise<ProviderDefinitionSaveResult>((resolve) => {
          calls.push({ request, resolve });
        }),
    );
    vi.stubGlobal('window', { electronAPI: { settings: { saveProviderDefinition } } });
    useAppSettingsStore
      .getState()
      .hydrate(...viewOf({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, providers: [provider] } }), 'dark');
    return calls;
  }
  const answer = (
    call: { request: ProviderDefinitionSaveRequest },
    entry: LlmProviderEntry,
    status: 'committed' | 'failed',
  ): ProviderDefinitionSaveResult => {
    const snapshot = {
      clientRevision: call.request.clientRevision,
      providerId: entry.id,
      commitHash: 'hash',
      provider: entry,
      catalogRevision: null,
    };
    return status === 'committed'
      ? { ...snapshot, status, lastSuccessful: snapshot }
      : { ...snapshot, status, provider: null, lastSuccessful: null, error: 'disk full' };
  };

  it('shows each choice at once and never lets the late answer to an earlier one undo a later one', async () => {
    const calls = deferredSaves();
    const first = useAppSettingsStore.getState().saveProvider(withChoices([false, true]));
    const second = useAppSettingsStore.getState().saveProvider(withChoices([false, false]));
    expect(enabledShown()).toEqual([false, false]);
    expect(calls[1]!.request.clientRevision).toBeGreaterThan(calls[0]!.request.clientRevision);

    calls[1]!.resolve(answer(calls[1]!, withChoices([false, false]), 'committed'));
    await expect(second).resolves.toMatchObject({ status: 'committed' });
    calls[0]!.resolve(answer(calls[0]!, withChoices([false, true]), 'committed'));
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    expect(enabledShown()).toEqual([false, false]);
  });

  it('drops only the failed choice and keeps a later one in flight', async () => {
    const calls = deferredSaves();
    const failed = useAppSettingsStore.getState().saveProvider(withChoices([false, true]));
    void useAppSettingsStore.getState().saveProvider(withChoices([false, false]));
    calls[0]!.resolve(answer(calls[0]!, provider, 'failed'));
    await failed;
    expect(enabledShown()).toEqual([false, false]);
  });
});
