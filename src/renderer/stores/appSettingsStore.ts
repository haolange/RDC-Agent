import { create } from 'zustand';
import type {
  AppLanguage,
  AppSettings,
  AppSettingsPatch,
  AppTheme,
  FontScale,
  LlmAgentRoute,
  LlmProviderEntry,
  ProfileSettings,
  ResolvedTheme,
} from '@shared/types/settings';
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from '@shared/constants/layout';
import { DEFAULT_MODEL_ROUTING } from '@shared/types/agent';

const createEmptyAgentRoutes = (): LlmAgentRoute[] =>
  Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId: agentId as LlmAgentRoute['agentId'],
    providerId: '',
    modelId: '',
  }));

const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: 'dark',
    language: 'zh-CN',
    fontScale: 'medium',
  },
  layout: {
    leftSidebar: {
      collapsed: false,
      width: LEFT_SIDEBAR_DEFAULT_WIDTH,
      expandedWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
    },
    rightPanel: {
      collapsed: false,
      width: RIGHT_PANEL_DEFAULT_WIDTH,
      expandedWidth: RIGHT_PANEL_DEFAULT_WIDTH,
    },
  },
  profile: {
    nickname: 'RDC Operator',
    avatarPath: '',
  },
  workspace: {
    rootPath: '',
  },
  llm: {
    providers: [],
    agentRoutes: createEmptyAgentRoutes(),
  },
  configuration: {
    activeModeProfileId: 'debugger.default',
    availableModeProfiles: [],
    diagnostics: [],
    lastMigrationSummary: [],
  },
  paths: {
    workspaceRoot: '',
    defaultWorkspaceRoot: '',
    settingsPath: '',
    logsPath: '',
    logPath: '',
    projectsPath: '',
    knowledgePath: '',
    migrationOrphansPath: '',
    profilesPath: '',
    policiesPath: '',
    secretsPath: '',
    migrationReportsPath: '',
  },
};

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
  setTheme: (theme: AppTheme) => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setFontScale: (fontScale: FontScale) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  updateWorkspaceRoot: (rootPath: string) => Promise<void>;
  resetWorkspaceRoot: () => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  saveAgentRoute: (route: LlmAgentRoute) => Promise<void>;
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
  updateWorkspaceRoot: async (rootPath) => {
    await get().patchSettings({ workspace: { rootPath } });
  },
  resetWorkspaceRoot: async () => {
    await get().patchSettings({ workspace: { rootPath: '' } });
  },
  saveProvider: async (provider) => {
    await get().patchSettings({
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
  saveAgentRoute: async (route) => {
    const nextRoutes = get().settings.llm.agentRoutes.some((entry) => entry.agentId === route.agentId)
      ? get().settings.llm.agentRoutes.map((entry) => entry.agentId === route.agentId ? route : entry)
      : [...get().settings.llm.agentRoutes, route];

    await get().patchSettings({
      llm: {
        agentRoutes: nextRoutes,
      },
    });
  },
}));
