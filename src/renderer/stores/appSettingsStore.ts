import { create } from 'zustand';
import type {
  AppLanguage,
  AgentPermissionMode,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  FontScale,
  LlmProviderEntry,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveResult,
  ProfileSettings,
  ResolvedTheme,
} from '@shared/types/settings';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from '@shared/types/agentManifest';
import { DEFAULT_SETTINGS } from './defaultAppSettings';
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

export { nextAgentDefinitionClientRevision } from './agentDefinitionSettings';

interface AppSettingsState {
  settings: AppSettings;
  hydrated: boolean;
  systemTheme: ResolvedTheme;
  hydrate: (settings: AppSettings, systemTheme: ResolvedTheme) => void;
  setSystemTheme: (systemTheme: ResolvedTheme) => void;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
  flushAgentDefinitionSaves: (agentId: string) => Promise<AgentDefinitionCommitSnapshot | null>;
  reloadSettings: () => Promise<AppSettings>;
  setTheme: (theme: AppTheme) => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setFontScale: (fontScale: FontScale) => Promise<void>;
  setComposerMarkdown: (composerMarkdown: boolean) => Promise<void>;
  setUsePointerCursors: (usePointerCursors: boolean) => Promise<void>;
  setContextBreakdownExpanded: (contextBreakdownExpanded: boolean) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>;
  flushProviderSaves: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
  removeProvider: (providerId: string) => Promise<void>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
}

const agentDefinitionMutations = new AgentDefinitionMutationCoordinator(
  (request) => window.electronAPI.settings.saveAgentDefinition(request),
);

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  systemTheme: 'dark',
  hydrate: (settings, systemTheme) => set({ settings, systemTheme, hydrated: true }),
  setSystemTheme: (systemTheme) => set({ systemTheme }),
  patchSettings: async (patch) => {
    const nextSettings = await window.electronAPI.settings.set(patch);
    set({ settings: nextSettings, hydrated: true });
    return nextSettings;
  },
  saveAgentDefinition: async (request) => {
    const agentId = request.draft.id;
    const optimistic = beginAgentDefinitionSave(get().settings, request);
    set({ settings: optimistic.settings });

    try {
      const result = await agentDefinitionMutations.enqueue(request);
      if (!isLatestAgentDefinitionRevision(agentId, request.clientRevision)) return result;
      if (result.status === 'failed') {
        set((state) => ({
          settings: rollbackAgentDefinitionSave(state.settings, agentId, result.lastSuccessful),
        }));
        return Promise.reject(new Error(result.error ?? 'Agent definition save failed.'));
      }
      if (result.status === 'committed') {
        set((state) => ({
          settings: settleAgentDefinitionSave(state.settings, agentId, result),
          hydrated: true,
        }));
      }
      return result;
    } catch (error) {
      if (isLatestAgentDefinitionRevision(agentId, request.clientRevision)) {
        const lastSuccessful = await window.electronAPI.settings.getAgentDefinitionCommit(agentId).catch(() => null);
        set((state) => ({
          settings: rollbackAgentDefinitionSave(state.settings, agentId, lastSuccessful),
        }));
      }
      throw error;
    }
  },
  flushAgentDefinitionSaves: async (agentId) => {
    await agentDefinitionMutations.flush(agentId);
    return window.electronAPI.settings.getAgentDefinitionCommit(agentId);
  },
  reloadSettings: async () => {
    const nextSettings = await window.electronAPI.settings.get();
    set({ settings: nextSettings, hydrated: true });
    return nextSettings;
  },
  setTheme: async (theme) => {
    await get().patchSettings({ appearance: { theme } });
  },
  setLanguage: async (language) => {
    await get().patchSettings({ appearance: { language } });
  },
  setFontScale: async (fontScale) => {
    await get().patchSettings({ appearance: { fontScale } });
  },
  setComposerMarkdown: async (composerMarkdown) => {
    await get().patchSettings({ appearance: { composerMarkdown } });
  },
  setUsePointerCursors: async (usePointerCursors) => {
    await get().patchSettings({ appearance: { usePointerCursors } });
  },
  setContextBreakdownExpanded: async (contextBreakdownExpanded) => {
    await get().patchSettings({ appearance: { contextBreakdownExpanded } });
  },
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
    await get().patchSettings({
      agentRuntime: {
        permissions: { mode },
      },
    });
  },
}));
