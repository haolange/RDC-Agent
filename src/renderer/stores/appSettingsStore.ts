import { create } from 'zustand';
import type {
  AppLanguage,
  AgentPermissionMode,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  FontScale,
  LlmProviderEntry,
  ProfileSettings,
  ResolvedTheme,
} from '@shared/types/settings';
import { DEFAULT_SETTINGS } from './defaultAppSettings';

const upsertProvider = (providers: LlmProviderEntry[], provider: LlmProviderEntry): LlmProviderEntry[] => {
  const exists = providers.some((entry) => entry.id === provider.id);
  return exists
    ? providers.map((entry) => entry.id === provider.id ? provider : entry)
    : [...providers, provider];
};

interface AppSettingsState {
  settings: AppSettings;
  hydrated: boolean;
  systemTheme: ResolvedTheme;
  hydrate: (settings: AppSettings, systemTheme: ResolvedTheme) => void;
  setSystemTheme: (systemTheme: ResolvedTheme) => void;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  reloadSettings: () => Promise<AppSettings>;
  setTheme: (theme: AppTheme) => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setFontScale: (fontScale: FontScale) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<AppSettings>;
  removeProvider: (providerId: string) => Promise<void>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
}

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
  updateProfile: async (profile) => {
    await get().patchSettings({ profile });
  },
  saveProvider: async (provider) => {
    return get().patchSettings({
      llm: {
        providers: upsertProvider(get().settings.llm.providers, provider),
      },
    });
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
