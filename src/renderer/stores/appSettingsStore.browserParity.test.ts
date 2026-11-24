import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { useAppSettingsStore } from './appSettingsStore';
import { buildConversationConfigurationCommit } from './conversationConfigurationCommit';
import type { LlmProviderEntry, ProviderDefinitionSaveResult } from '@shared/types/settings';

const DEFAULT_SETTINGS = createDefaultAppSettings();

describe('app settings browser parity', () => {
  afterEach(() => {
    useAppSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      contextBreakdownPreference: null,
      hydrated: false,
      systemTheme: 'dark',
    });
    vi.unstubAllGlobals();
  });

  it('persists a language change once and updates the hydrated store', async () => {
    const persisted = {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, language: 'en' as const },
    };
    const setSettings = vi.fn().mockResolvedValue(persisted);
    vi.stubGlobal('window', {
      electronAPI: { settings: { set: setSettings } },
    });
    useAppSettingsStore.getState().hydrate(DEFAULT_SETTINGS, 'dark');

    await useAppSettingsStore.getState().setLanguage('en');

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith({ appearance: { language: 'en' } });
    expect(useAppSettingsStore.getState().settings.appearance.language).toBe('en');
    expect(useAppSettingsStore.getState().hydrated).toBe(true);
  });

  it('adopts only the saved context preference when an older settings snapshot arrives', async () => {
    let resolveSave!: (settings: typeof DEFAULT_SETTINGS) => void;
    const reply = new Promise<typeof DEFAULT_SETTINGS>((resolve) => { resolveSave = resolve; });
    const setSettings = vi.fn().mockReturnValue(reply);
    vi.stubGlobal('window', { electronAPI: { settings: { set: setSettings } } });
    const store = useAppSettingsStore;
    store.getState().hydrate(DEFAULT_SETTINGS, 'dark');

    const saving = store.getState().setContextBreakdownExpanded(true);
    expect(store.getState().contextBreakdownPreference).toEqual({ expanded: true });
    expect(store.getState().settings.appearance.contextBreakdownExpanded).toBe(false);
    store.getState().replaceSettings({
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light' },
    });
    resolveSave({
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_SETTINGS.appearance, contextBreakdownExpanded: true },
    });
    await saving;

    expect(setSettings).toHaveBeenCalledExactlyOnceWith({ appearance: { contextBreakdownExpanded: true } });
    expect(store.getState().settings.appearance).toMatchObject({ theme: 'light', contextBreakdownExpanded: true });
  });

  it('reads the current model commit on a later send after a pending preference write fails', async () => {
    const provider = {
      id: 'configured-provider', enabled: true, isConfigured: true,
      models: [{ id: 'model-a', label: 'Model A', enabled: true }],
    } as LlmProviderEntry;
    const getCommit = vi.fn().mockResolvedValue({ commitHash: 'last-committed-provider', provider });
    vi.stubGlobal('window', { electronAPI: { settings: {
      getAgentDefinitionCommit: vi.fn().mockResolvedValue(null),
      saveProviderDefinition: vi.fn().mockRejectedValue(new Error('Model preference write failed')),
      getProviderDefinitionCommit: getCommit,
    } } });
    const store = useAppSettingsStore.getState();
    store.hydrate({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, providers: [provider] } }, 'dark');
    const saving = store.saveProvider({ ...provider, models: [{ ...provider.models[0], enabled: false }] });
    const attempt = () => buildConversationConfigurationCommit({
      selectedAgentId: 'general',
      modelOverride: { providerId: provider.id, modelId: 'model-a' },
      getEffectiveCatalog: async () => ({
        catalogRevision: 'catalog-current', models: [{ modelId: 'model-a', routeRevision: 'route-current' }],
      }),
    });
    await expect(attempt()).rejects.toThrow('Model preference write failed');
    await expect(saving).resolves.toMatchObject({ status: 'failed' });
    expect(getCommit).not.toHaveBeenCalled();

    await expect(attempt()).resolves.toMatchObject({ configurationCommit: {
      providerCommitHash: 'last-committed-provider', providerCatalogRevision: 'catalog-current', routeRevision: 'route-current',
    } });
    expect(getCommit).toHaveBeenCalledExactlyOnceWith(provider.id);
  });

  it('keeps the current account when a previous connection’s successful model save arrives late', async () => {
    const provider = {
      id: 'reconnecting-provider', activeAccountId: 'previous', enabled: true, isConfigured: true,
      models: [{ id: 'model-a', label: 'Model A', enabled: true }],
    } as LlmProviderEntry;
    const stored = (entry: LlmProviderEntry) => ({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, providers: [entry] } });
    let finishSave!: (receipt: ProviderDefinitionSaveResult) => void;
    const save = vi.fn().mockImplementation(() => new Promise<ProviderDefinitionSaveResult>((resolve) => { finishSave = resolve; }));
    vi.stubGlobal('window', { electronAPI: { settings: {
      saveProviderDefinition: save,
      getProviderDefinitionCommit: vi.fn().mockResolvedValue(null),
    } } });
    const store = useAppSettingsStore.getState();
    store.hydrate(stored(provider), 'dark');

    const edit = { ...provider, models: [{ ...provider.models[0], enabled: false }] };
    const pending = store.saveProvider(edit);
    const flush = store.flushProviderSaves(provider.id);
    const next = { ...provider, activeAccountId: 'current' };
    store.replaceSettings(stored(next));
    const receipt = {
      clientRevision: save.mock.calls[0][0].clientRevision,
      providerId: provider.id, provider: edit, commitHash: 'previous-account', catalogRevision: null,
    };
    finishSave({ ...receipt, status: 'committed', lastSuccessful: receipt });

    await expect(pending).resolves.toMatchObject({ status: 'superseded' });
    await flush;
    expect(useAppSettingsStore.getState().settings.llm.providers).toEqual([next]);
  });
});
