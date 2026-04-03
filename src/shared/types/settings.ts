import type { AgentRole } from './agent';

export type AppTheme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type AppLanguage = 'zh-CN' | 'en';
export type FontScale = 'small' | 'medium' | 'large';
export type BuiltinLlmProviderId =
  | 'openrouter'
  | 'minimax'
  | 'zai'
  | 'volcengine'
  | '302ai'
  | 'ollama'
  | 'siliconflow'
  | 'openai'
  | 'anthropic';
export type LlmProviderId = BuiltinLlmProviderId | (string & {});
export type LlmProviderKind = 'openrouter' | 'openai-compatible' | 'anthropic' | 'ollama';

export interface SidebarLayoutPreference {
  collapsed: boolean;
  width: number;
  expandedWidth: number;
}

export interface LayoutPreferences {
  leftSidebar: SidebarLayoutPreference;
  rightPanel: SidebarLayoutPreference;
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
}

export interface LlmProviderModel {
  id: string;
  label: string;
  enabled: boolean;
}

export interface LlmProviderEntry {
  id: LlmProviderId;
  kind: LlmProviderKind;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  models: LlmProviderModel[];
  recommendedModels: string[];
  docsUrl?: string;
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

export interface AppSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  workspace: WorkspaceSettings;
  llm: LlmSettings;
  paths: AppRuntimePaths;
}

export type AppSettingsPatch = Partial<{
  appearance: Partial<UiPreferences>;
  layout: Partial<{
    leftSidebar: Partial<SidebarLayoutPreference>;
    rightPanel: Partial<SidebarLayoutPreference>;
  }>;
  profile: Partial<ProfileSettings>;
  workspace: Partial<WorkspaceSettings>;
  llm: Partial<{
    providers: LlmProviderEntry[];
    agentRoutes: LlmAgentRoute[];
  }>;
}>;
