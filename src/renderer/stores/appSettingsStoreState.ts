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
  ReduceMotionPreference,
  ResolvedTheme,
  ThemeChromeConfig,
  ThemeVariant,
} from '@shared/types/settings';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from '@shared/types/agentManifest';
import type { AgentRouteSyncState } from './agentRouteSyncState';

export interface AppSettingsState {
  settings: AppSettings;
  hydrated: boolean;
  systemTheme: ResolvedTheme;
  agentRouteSyncById: Record<string, AgentRouteSyncState>;
  hydrate: (settings: AppSettings, systemTheme: ResolvedTheme) => void;
  setSystemTheme: (systemTheme: ResolvedTheme) => void;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
  flushAgentDefinitionSaves: (
    query: import('@shared/types/agentManifest').AgentDefinitionCommitQuery,
  ) => Promise<AgentDefinitionCommitSnapshot | null>;
  reloadSettings: () => Promise<AppSettings>;
  setTheme: (theme: AppTheme) => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setFontScale: (fontScale: FontScale) => Promise<void>;
  setComposerMarkdown: (composerMarkdown: boolean) => Promise<void>;
  setUsePointerCursors: (usePointerCursors: boolean) => Promise<void>;
  setReduceMotion: (reduceMotion: ReduceMotionPreference) => Promise<void>;
  setChromeTheme: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => Promise<void>;
  setContextBreakdownExpanded: (contextBreakdownExpanded: boolean) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>;
  flushProviderSaves: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
  removeProvider: (providerId: string) => Promise<void>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  setCompactionThresholdPercent: (percent: number) => Promise<void>;
}
