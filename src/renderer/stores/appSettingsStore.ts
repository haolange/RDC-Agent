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
import type { AppSettingsState } from './appSettingsStoreState';

export { nextAgentDefinitionClientRevision } from './agentDefinitionSettings';

const agentDefinitionMutations = new AgentDefinitionMutationCoordinator(
  (request) => window.electronAPI.settings.saveAgentDefinition(request),
);


const patchIntents = new SettingsPatchIntents();

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  settings: createDefaultAppSettings(),
  contextBreakdownPreference: null,
  hydrated: false,
  systemTheme: 'dark',
  hydrate: (settings, systemTheme) => set({ settings: patchIntents.rebase(settings), systemTheme, hydrated: true }),
  setSystemTheme: (systemTheme) => set({ systemTheme }),
  patchSettings: async (ops) => {
    const intent = patchIntents.begin(get().settings, ops);
    set({ settings: intent.settings });
    try {
      const result = await window.electronAPI.settings.patch(ops);
      set((state) => ({ settings: patchIntents.settle(state.settings, intent.id, result.changed), hydrated: true }));
      return get().settings;
    } catch (error) {
      set((state) => ({ settings: patchIntents.fail(state.settings, intent.id) }));
      throw error;
    }
  },
  replaceSettings: (settings) => set({ settings: patchIntents.rebase(settings), hydrated: true }),
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
    set({ settings: patchIntents.rebase(nextSettings), hydrated: true });
    return get().settings;
  },
  ...createAppSettingsAppearanceActions(get, (contextBreakdownPreference) => set({ contextBreakdownPreference })),
  updateProfile: async (profile) => {
    await get().patchSettings([{ op: 'profile', value: profile }]);
  },
  saveProvider: async (provider) => {
    const clientRevision = beginProviderDefinitionSave(provider.id);
    const result = await enqueueProviderDefinitionSave(provider, clientRevision);
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
}));
