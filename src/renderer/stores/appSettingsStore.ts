import { create } from 'zustand';
import { useRuntimePermissionStore } from './runtimePermissionStore';
import { DEFAULT_AGENT_RUNTIME, createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
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
  rollbackProviderDefinitionSave,
  settleProviderDefinitionSave,
} from './providerDefinitionSettings';
import type { AppSettingsState } from './appSettingsStoreState';
import { createAppSettingsAppearanceActions } from './appSettingsAppearanceActions';
import {
  withCompactionThresholdPercent,
  withPermissionMode,
} from './appSettingsRuntimePatch';

export { nextAgentDefinitionClientRevision } from './agentDefinitionSettings';

const agentDefinitionMutations = new AgentDefinitionMutationCoordinator(
  (request) => window.electronAPI.settings.saveAgentDefinition(request),
);


export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  settings: createDefaultAppSettings(),
  hydrated: false,
  systemTheme: 'dark',
  hydrate: (settings, systemTheme) => set({ settings, systemTheme, hydrated: true }),
  setSystemTheme: (systemTheme) => set({ systemTheme }),
  patchSettings: async (patch) => {
    const nextSettings = await window.electronAPI.settings.set(patch);
    set({ settings: nextSettings, hydrated: true });
    return nextSettings;
  },
  replaceSettings: (settings) => set({ settings, hydrated: true }),
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
  reloadSettings: async () => {
    const nextSettings = await window.electronAPI.settings.get();
    set({ settings: nextSettings, hydrated: true });
    return nextSettings;
  },
  ...createAppSettingsAppearanceActions(get),
  updateProfile: async (profile) => {
    await get().patchSettings({ profile });
  },
  saveProvider: async (provider) => {
    const optimistic = beginProviderDefinitionSave(get().settings, provider);
    set({ settings: optimistic.settings });
    const result = await enqueueProviderDefinitionSave(provider, optimistic.clientRevision);
    if (!isLatestProviderDefinitionRevision(provider.id, optimistic.clientRevision)) return result;
    if (result.status === 'failed') {
      set((state) => ({
        settings: rollbackProviderDefinitionSave(
          state.settings, provider.id, result.lastSuccessful, optimistic.previous,
        ),
      }));
      throw new Error(result.error ?? 'Provider settings save failed.');
    }
    if (result.status === 'committed' && result.provider) {
      set((state) => ({
        settings: settleProviderDefinitionSave(state.settings, result.provider!),
        hydrated: true,
      }));
    }
    return result;
  },
  flushProviderSaves: async (providerId) => {
    return flushProviderDefinitionSaves(providerId);
  },
  removeProvider: async (providerId) => {
    await get().patchSettings({
      llm: {
        providers: get().settings.llm.providers.filter((entry) => entry.id !== providerId),
      },
    });
  },
  setAgentPermissionMode: async (mode) => {
    try {
      await useRuntimePermissionStore.getState().saveMode(mode);
    } finally {
      const snapshot = useRuntimePermissionStore.getState().snapshot;
      if (snapshot) set((state) => ({ settings: withPermissionMode(state.settings, snapshot.mode) }));
    }
  },
  setCustomPermissionRules: async (rules) => {
    const nextSettings = await window.electronAPI.settings.set({
      agentRuntime: { permissions: rules },
    });
    set({ settings: nextSettings, hydrated: true });
  },
  setCompactionThresholdPercent: async (percent) => {
    const previous = get().settings.agentRuntime?.context?.compactionThresholdPercent
      ?? DEFAULT_AGENT_RUNTIME.context.compactionThresholdPercent;
    if (previous === percent) return;
    set((state) => ({ settings: withCompactionThresholdPercent(state.settings, percent), hydrated: true }));
    try {
      const nextSettings = await window.electronAPI.settings.set({
        agentRuntime: { context: { compactionThresholdPercent: percent } },
      });
      set({ settings: nextSettings, hydrated: true });
    } catch (error) {
      set((state) => ({ settings: withCompactionThresholdPercent(state.settings, previous) }));
      throw error;
    }
  },
}));
