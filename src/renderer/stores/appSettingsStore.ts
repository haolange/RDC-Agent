import { create } from 'zustand';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';
import { createSettingsDefinitionActions } from './appSettingsDefinitionActions';
import { SettingsIntents, patchCommit, patchOverlay } from './settingsIntents';
import { SettingsViewSync, joinSettingsView } from './settingsViewSync';
import { useProjectStore } from './projectStore';
import type { AppSettings, LlmProviderCatalogResponse, SettingsView } from '@shared/types/settings';
import type { AppSettingsState } from './appSettingsStoreState';

const EMPTY_PROVIDER_CATALOG: LlmProviderCatalogResponse = { categories: [], protocols: [], providers: [] };

export const useAppSettingsStore = create<AppSettingsState>((set, get) => {
  /** Confirmed settings plus every intent in flight; the store's `settings` is always its projection. */
  const intents = new SettingsIntents(createDefaultAppSettings());
  const join = (view: SettingsView): AppSettings =>
    joinSettingsView(view, get().providerCatalog ?? EMPTY_PROVIDER_CATALOG);
  /** Joins a view main sent whole and adopts it by revision; intents in flight stay on top. */
  const adoptView = (view: SettingsView): void => {
    viewSync.adopted(view);
    set({ settings: intents.rebase(join(view), view.revision), hydrated: true });
  };
  const viewSync = new SettingsViewSync(async () => {
    const api = window.electronAPI;
    const [view, catalog] = await Promise.all([
      api.settings.get(),
      get().providerCatalog ?? api.settings.getProviderCatalog(),
    ]);
    if (!get().providerCatalog) set({ providerCatalog: catalog });
    adoptView(view);
  });
  const show = (settings: AppSettings, confirmed = false): void =>
    set(confirmed ? { settings, hydrated: true } : { settings });
  return {
    settings: createDefaultAppSettings(),
    providerCatalog: null,
    contextBreakdownPreference: null,
    hydrated: false,
    systemTheme: 'dark',
    hydrate: (view, providerCatalog, systemTheme) => {
      set({ providerCatalog, systemTheme });
      viewSync.adopted(view);
      set({ settings: intents.start(join(view), view.revision), hydrated: true });
    },
    setSystemTheme: (systemTheme) => set({ systemTheme }),
    patchSettings: async (ops) => {
      const intent = intents.begin(patchOverlay(ops));
      show(intent.settings);
      try {
        const result = await viewSync.ownWrite(
          () => window.electronAPI.settings.patch(ops),
          (committed) => committed.revision,
        );
        show(intents.settle(intent.id, patchCommit(ops, result), result.revision), true);
        return get().settings;
      } catch (error) {
        show(intents.fail(intent.id));
        throw error;
      }
    },
    adoptView,
    adoptSettingsChange: (change) => viewSync.changed(change),
    ...createSettingsDefinitionActions({ intents, viewSync, settings: () => get().settings, show }),
    reloadSettings: async (forProjectId) => {
      // Without a project named, the selected one; with none selected yet there is no project to compare.
      const projectId =
        forProjectId !== undefined ? forProjectId : useProjectStore.getState().currentProject?.projectId;
      if (viewSync.stale(projectId)) await viewSync.readFor(projectId);
      return get().settings;
    },
    refreshSettings: async () => {
      await viewSync.readFresh();
      return get().settings;
    },
    ...createAppSettingsAppearanceActions(get, (contextBreakdownPreference) => set({ contextBreakdownPreference })),
    updateProfile: async (profile) => {
      await get().patchSettings([{ op: 'profile', value: profile }]);
    },
    setCustomPermissionRules: async (rules) => {
      await get().patchSettings([{ op: 'agentRuntime', value: { permissions: rules } }]);
    },
    setCompactionThresholdPercent: async (percent) => {
      const previous = get().settings.agentRuntime.context.compactionThresholdPercent;
      if (previous === percent) return;
      await get().patchSettings([{ op: 'agentRuntime', value: { context: { compactionThresholdPercent: percent } } }]);
    },
  };
});
