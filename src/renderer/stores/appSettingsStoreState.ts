import type {
  AppLanguage,
  AgentPermissionMode,
  AppSettings,
  AppTheme,
  FontScale,
  LlmProviderEntry,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveResult,
  ProfileSettings,
  LlmProviderCatalogResponse,
  SettingsChangedPayload,
  SettingsPatchOp,
  SettingsView,
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
  /** The provider catalog, read once at startup; `settings` joins each connection with it. */
  providerCatalog: LlmProviderCatalogResponse | null;
  /** The Composer's current preference, including an intent that could not be saved. */
  contextBreakdownPreference: { expanded: boolean; error?: string } | null;
  hydrated: boolean;
  systemTheme: ResolvedTheme;
  hydrate: (view: SettingsView, providerCatalog: LlmProviderCatalogResponse, systemTheme: ResolvedTheme) => void;
  setSystemTheme: (systemTheme: ResolvedTheme) => void;
  /**
   * Applies the ops optimistically and commits them with `settings:patch`; resolves to the settings once main
   * confirmed them. A failure rolls back what these ops changed, unless a later intent changed it again.
   */
  patchSettings: (ops: SettingsPatchOp[]) => Promise<AppSettings>;
  /** Adopts a view main returned from a settings command other than `settings:patch`. */
  replaceSettings: (view: SettingsView) => void;
  /** `settings:changed`: reads the view again for a change this renderer did not make (see `SettingsViewSync`). */
  adoptSettingsChange: (change: SettingsChangedPayload) => void;
  saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
  flushAgentDefinitionSaves: (
    query: import('@shared/types/agentManifest').AgentDefinitionCommitQuery,
  ) => Promise<AgentDefinitionCommitSnapshot | null>;
  /**
   * Reads the view only when it may be out of date: a change this renderer did not make, or Agents of another project
   * than `forProjectId` (default: the selected project).
   */
  reloadSettings: (forProjectId?: string | null) => Promise<AppSettings>;
  /** Reads the view now; opening Settings picks up edits made outside the app this way. */
  refreshSettings: () => Promise<AppSettings>;
  setTheme: (theme: AppTheme) => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setFontScale: (fontScale: FontScale) => Promise<void>;
  setComposerMarkdown: (composerMarkdown: boolean) => Promise<void>;
  setChromeTheme: (variant: ThemeVariant, chrome: Partial<ThemeChromeConfig>) => Promise<void>;
  setContextBreakdownExpanded: (contextBreakdownExpanded: boolean) => Promise<void>;
  setWorkProcessExpansion: (workProcessExpansion: import('@shared/types/settings').WorkProcessExpansion) => Promise<void>;
  updateProfile: (profile: Partial<ProfileSettings>) => Promise<void>;
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>;
  flushProviderSaves: (providerId: string) => Promise<ProviderDefinitionCommitSnapshot | null>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  setCompactionThresholdPercent: (percent: number) => Promise<void>;
  setCustomPermissionRules: (rules: {
    readableRoots: string[];
    writableRoots: string[];
    allowedCommandPrefixes: string[];
    deniedCommandPrefixes: string[];
  }) => Promise<void>;
}
