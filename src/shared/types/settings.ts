import type { AgentRole } from './agent';
import type { ExecutionModeProfileDescriptor } from './profile';

export type AppTheme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type AppLanguage = 'zh-CN' | 'en';
export type FontScale = 'small' | 'medium' | 'large';
export type BuiltinLlmProviderId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'xai'
  | 'kimi'
  | 'minimax'
  | 'zai'
  | 'qwen'
  | 'volcengine'
  | '302ai'
  | 'siliconflow'
  | 'ollama'
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot';
export type LlmProviderId = BuiltinLlmProviderId | (string & {});
export type LlmProviderKind = 'openrouter' | 'openai-compatible' | 'anthropic' | 'ollama';
export type LlmProviderAuthMode = 'api-key' | 'local' | 'account';
export type LlmProviderCatalogGroup = 'api-key' | 'local' | 'account';
export type LlmProviderConnectionStatus = 'unconfigured' | 'verified' | 'failed' | 'unavailable';
export type LlmProviderModelDiscoveryStrategy =
  | 'openai-compatible'
  | 'anthropic'
  | 'ollama-tags'
  | 'gemini';

export interface SidebarLayoutPreference {
  collapsed: boolean;
  width: number;
  expandedWidth: number;
}

export interface TerminalLayoutPreference {
  height: number;
}

export interface LayoutPreferences {
  leftSidebar: SidebarLayoutPreference;
  rightPanel: SidebarLayoutPreference;
  terminal: TerminalLayoutPreference;
}

export interface UiPreferences {
  theme: AppTheme;
  language: AppLanguage;
  fontScale: FontScale;
}

export interface ProfileSettings {
  nickname: string;
  avatarPath?: string;
}

export interface WorkspaceSettings {
  rootPath: string;
}

export interface AppRuntimePaths {
  workspaceRoot: string;
  defaultWorkspaceRoot: string;
  settingsPath: string;
  logsPath: string;
  logPath: string;
  projectsPath: string;
  knowledgePath: string;
  migrationOrphansPath: string;
  profilesPath: string;
  policiesPath: string;
  secretsPath: string;
  migrationReportsPath: string;
}

export interface LlmProviderModel {
  id: string;
  label: string;
  enabled: boolean;
  contextWindowTokens?: number | null;
}

export interface LlmProviderEntry {
  id: LlmProviderId;
  kind: LlmProviderKind;
  authMode: LlmProviderAuthMode;
  catalogGroup: LlmProviderCatalogGroup;
  modelDiscovery: LlmProviderModelDiscoveryStrategy | null;
  label: string;
  enabled: boolean;
  apiKey: string;
  secretRef?: string;
  hasStoredSecret: boolean;
  baseUrl?: string;
  models: LlmProviderModel[];
  recommendedModels: string[];
  docsUrl?: string;
  status: LlmProviderConnectionStatus;
  lastTestedAt?: string;
  lastModelRefreshAt?: string;
  lastError?: string;
  accountLoginConfigured?: boolean;
  unavailableReason?: string;
  isConfigured: boolean;
}

export interface LlmAgentRoute {
  agentId: AgentRole;
  providerId: LlmProviderId;
  modelId: string;
}

export interface LlmSettings {
  providers: LlmProviderEntry[];
  agentRoutes: LlmAgentRoute[];
}

export interface SettingsDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

export interface ConfigurationSettings {
  activeModeProfileId: string;
  availableModeProfiles: ExecutionModeProfileDescriptor[];
  lastMigrationReportPath?: string;
  lastMigrationSummary: string[];
  diagnostics: SettingsDiagnostic[];
}

export interface AppSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  workspace: WorkspaceSettings;
  llm: LlmSettings;
  configuration: ConfigurationSettings;
  paths: AppRuntimePaths;
}

export type AppSettingsPatch = Partial<{
  appearance: Partial<UiPreferences>;
  layout: Partial<{
    leftSidebar: Partial<SidebarLayoutPreference>;
    rightPanel: Partial<SidebarLayoutPreference>;
    terminal: Partial<TerminalLayoutPreference>;
  }>;
  profile: Partial<ProfileSettings>;
  workspace: Partial<WorkspaceSettings>;
  llm: Partial<{
    providers: LlmProviderEntry[];
    agentRoutes: LlmAgentRoute[];
  }>;
  configuration: Partial<ConfigurationSettings>;
}>;

export interface LlmProviderDraftRequest {
  providerId: LlmProviderId;
  apiKey?: string;
}

export interface LlmProviderConnectionResult {
  success: boolean;
  provider?: LlmProviderEntry;
  models: LlmProviderModel[];
  error?: string;
}

export interface LlmProviderAccountStatus {
  providerId: LlmProviderId;
  available: boolean;
  connected: boolean;
  message?: string;
  error?: string;
}
