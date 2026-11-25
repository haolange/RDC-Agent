import { create } from 'zustand';
import { DEFAULT_AGENT_RUNTIME, createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { useRuntimePermissionStore } from './runtimePermissionStore';
import {
  beginAgentDefinitionSave,
  isLatestAgentDefinitionRevision,
  rollbackAgentDefinitionSave,
  settleAgentDefinitionSave,
} from './agentDefinitionSettings';
import { AgentDefinitionMutationCoordinator } from './AgentDefinitionMutationCoordinator';
import {
  beginProviderDefinitionSave,
  enqueueProviderDefinitionSave,
  flushProviderDefinitionSaves,
  isLatestProviderDefinitionRevision,
  settleProviderDefinitionSave,
} from './providerDefinitionSettings';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';
import { SettingsPatchIntents } from './settingsPatchIntents';
import { SettingsViewSync, joinSettingsView } from './settingsViewSync';
import { useProjectStore } from './projectStore';
import type { LlmProviderCatalogResponse, SettingsView } from '@shared/types/settings';
import type { AppSettingsState } from './appSettingsStoreState';

export { nextAgentDefinitionClientRevision } from './agentDefinitionSettings';

const agentDefinitionMutations = new AgentDefinitionMutationCoordinator(
  (request) => window.electronAPI.settings.saveAgentDefinition(request),
);


const patchIntents = new SettingsPatchIntents();
const EMPTY_PROVIDER_CATALOG: LlmProviderCatalogResponse = { categories: [], protocols: [], providers: [] };

export const useAppSettingsStore = create<AppSettingsState>((set, get) => {
  /** Joins a view main sent whole and adopts it; ops in flight stay on top. */
  const adoptView = (view: SettingsView): void => {
    viewSync.adopted(view);
    const joined = joinSettingsView(view, get().providerCatalog ?? EMPTY_PROVIDER_CATALOG);
    set({ settings: patchIntents.rebase(joined, view.revision), hydrated: true });
  };
  const viewSync = new SettingsViewSync(async () => {
    const api = window.electronAPI;
    const [view, catalog] = await Promise.all([api.settings.get(), get().providerCatalog ?? api.settings.getProviderCatalog()]);
    if (!get().providerCatalog) set({ providerCatalog: catalog });
    adoptView(view);
  });
  return {
    settings: createDefaultAppSettings(),
    providerCatalog: null,
    contextBreakdownPreference: null,
    hydrated: false,
    systemTheme: 'dark',
    hydrate: (view, providerCatalog, systemTheme) => {
      set({ providerCatalog, systemTheme });
      adoptView(view);
    },
    setSystemTheme: (systemTheme) => set({ systemTheme }),
    patchSettings: async (ops) => {
      const intent = patchIntents.begin(get().settings, ops);
      set({ settings: intent.settings });
      try {
        const result = await viewSync.ownWrite(() => window.electronAPI.settings.patch(ops), (committed) => committed.revision);
        set((state) => ({ settings: patchIntents.settle(state.settings, intent.id, result), hydrated: true }));
        return get().settings;
      } catch (error) {
        set((state) => ({ settings: patchIntents.fail(state.settings, intent.id) }));
        throw error;
      }
    },
    replaceSettings: adoptView,
    adoptSettingsChange: (change) => viewSync.changed(change),
    saveAgentDefinition: async (request) => {
      const agentId = request.draft.id;
      const optimistic = beginAgentDefinitionSave(get().settings, request);
      set({ settings: optimistic.settings });

      try {
        const result = await agentDefinitionMutations.enqueue(request);
        if (!isLatestAgentDefinitionRevision(request.scope, request.projectId, agentId, request.clientRevision)) return result;
        if (result.status === 'failed') {
          set((state) => ({ settings: rollbackAgentDefinitionSave(state.settings, agentId, result.lastSuccessful) }));
          return Promise.reject(new Error(result.error ?? 'Agent definition save failed.'));
        }
        if (result.status === 'committed') {
          set((state) => ({ settings: settleAgentDefinitionSave(state.settings, agentId, result), hydrated: true }));
        }
        return result;
      } catch (error) {
        if (isLatestAgentDefinitionRevision(request.scope, request.projectId, agentId, request.clientRevision)) {
          const lastSuccessful = await window.electronAPI.settings.getAgentDefinitionCommit({
            agentId,
            scope: request.scope,
            projectId: request.projectId,
          }).catch(() => null);
          set((state) => ({ settings: rollbackAgentDefinitionSave(state.settings, agentId, lastSuccessful) }));
        }
        throw error;
      }
    },
    flushAgentDefinitionSaves: async (query) => {
      await agentDefinitionMutations.flush(query);
      return window.electronAPI.settings.getAgentDefinitionCommit(query);
    },
    reloadSettings: async (forProjectId) => {
      // Without a project named, the selected one; with none selected yet there is no project to compare.
      const projectId = forProjectId !== undefined ? forProjectId : useProjectStore.getState().currentProject?.projectId;
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
    saveProvider: async (provider) => {
      const clientRevision = beginProviderDefinitionSave(provider.id);
      const result = await viewSync.ownWrite(() => enqueueProviderDefinitionSave(provider, clientRevision), (saved) => saved.revision);
      const current = get().settings.llm.providers.find((entry) => entry.id === provider.id);
      if (!isLatestProviderDefinitionRevision(provider.id, clientRevision)
        || !current || providerConnectionIdentity(current) !== providerConnectionIdentity(provider)) {
        return { ...result, status: 'superseded' };
      }
      const confirmed = result.status === 'committed' ? result.provider : result.lastSuccessful?.provider;
      if (confirmed) {
        set((state) => ({
          settings: settleProviderDefinitionSave(state.settings, confirmed),
          hydrated: true,
        }));
      }
      return result;
    },
    flushProviderSaves: async (providerId) => {
      return flushProviderDefinitionSaves(providerId);
    },
    setAgentPermissionMode: async (mode) => {
      try {
        await useRuntimePermissionStore.getState().saveMode(mode);
      } finally {
        const snapshot = useRuntimePermissionStore.getState().snapshot;
        if (snapshot) {
          set((state) => ({ settings: patchIntents.confirm(state.settings, (view) => ({
            ...view, agentRuntime: { ...view.agentRuntime, permissions: { ...view.agentRuntime.permissions, mode: snapshot.mode } },
          })) }));
        }
      }
    },
    setCustomPermissionRules: async (rules) => {
      await get().patchSettings([{ op: 'agentRuntime', value: { permissions: rules } }]);
    },
    setCompactionThresholdPercent: async (percent) => {
      const previous = get().settings.agentRuntime?.context?.compactionThresholdPercent
        ?? DEFAULT_AGENT_RUNTIME.context.compactionThresholdPercent;
      if (previous === percent) return;
      await get().patchSettings([{ op: 'agentRuntime', value: { context: { compactionThresholdPercent: percent } } }]);
    },
  };
});
