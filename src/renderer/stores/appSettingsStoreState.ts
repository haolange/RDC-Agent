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
  ThemeChromeConfig,
  ThemeVariant,
} from '@shared/types/settings';
import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
} from '@shared/types/agentManifest';

export interface AppSettingsState {
  settings: AppSettings;
  hydrated: boolean;
  systemTheme: ResolvedTheme;
  hydrate: (settings: AppSettings, systemTheme: ResolvedTheme) => void;
  setSystemTheme: (systemTheme: ResolvedTheme) => void;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  /** Adopts a snapshot main returned from a settings command other than `settings:set`. */
  replaceSettings: (settings: AppSettings) => void;
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
  setChromeTheme: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => Promise<void>;
  setContextBreakdownExpanded: (contextBreakdownExpanded: boolean) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>;
  flushProviderSaves: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
  removeProvider: (providerId: string) => Promise<void>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  setCompactionThresholdPercent: (percent: number) => Promise<void>;
  setCustomPermissionRules: (rules: {
    readableRoots: string[];
    writableRoots: string[];
    allowedCommandPrefixes: string[];
    deniedCommandPrefixes: string[];
  }) => Promise<void>;
}
