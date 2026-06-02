import type { AgentRole } from './agent';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimePatternDescriptor,
  AgentRuntimeSkillDescriptor,
} from './agentRuntime';
import type { ExecutionModeProfileDescriptor } from './profile';

export type AppTheme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type AppLanguage = 'zh-CN' | 'en';
export type FontScale = 'small' | 'medium' | 'large';
export type BuiltinLlmProviderId =
  | 'openrouter'
  | 'openai'
  | 'openai-eu'
  | 'openai-us'
  | 'anthropic'
  | 'anthropic-thirdparty'
  | 'azure-openai'
  | 'deepseek'
  | 'xai'
  | 'google-ai-studio'
  | 'groq'
  | 'mistral'
  | 'cerebras'
  | 'huggingface'
  | 'glm-cn'
  | 'glm-global'
  | 'kimi-code'
  | 'moonshot'
  | 'minimax-cn'
  | 'minimax-global'
  | 'xiaomi-mimo'
  | 'xiaomi-mimo-token-plan'
  | 'bailian'
  | 'bedrock'
  | 'vertex'
  | 'qwen'
  | 'volcengine'
  | 'vercel-ai-gateway'
  | 'manifest'
  | 'custom-endpoint'
  | 'litellm'
  | '302ai'
  | 'siliconflow'
  | 'ollama'
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot';
export type LlmProviderId = BuiltinLlmProviderId | (string & {});
export type LlmProviderKind = 'openrouter' | 'openai-compatible' | 'anthropic' | 'google-ai-studio' | 'azure-openai' | 'bedrock' | 'vertex' | 'ollama';
export type LlmProviderAuthMode = 'api-key' | 'local' | 'account' | 'environment';
export type LlmProviderCatalogGroup = 'api-key' | 'local' | 'account' | 'environment';
export type LlmProviderConnectionStatus = 'unconfigured' | 'verified' | 'failed' | 'unavailable';
export type LlmProviderModelDiscoveryStrategy =
  | 'openai-compatible'
  | 'anthropic'
  | 'anthropic-candidate-validation'
  | 'google-ai-studio'
  | 'azure-openai'
  | 'ollama-tags'
  | 'account-catalog'
  | 'static';

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
  skillsPath: string;
  mcpPath: string;
  patternsPath: string;
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
  baseUrlEditable?: boolean;
  models: LlmProviderModel[];
  recommendedModels: string[];
  docsUrl?: string;
  status: LlmProviderConnectionStatus;
  lastTestedAt?: string;
  lastModelRefreshAt?: string;
  lastError?: string;
  accountLoginConfigured?: boolean;
  accountLabel?: string;
  planLabel?: string;
  oauthExpiresAt?: string;
  oauthRefreshAvailable?: boolean;
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
  enabledSkillIds: string[];
  enabledMcpServerIds: string[];
  modePatternBindings: Record<string, string>;
  availablePatterns: AgentRuntimePatternDescriptor[];
  availableSkills: AgentRuntimeSkillDescriptor[];
  availableMcpServers: AgentRuntimeMcpDescriptor[];
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
  baseUrl?: string;
}

export interface LlmProviderAccountLoginFinishRequest {
  providerId: LlmProviderId;
  code?: string;
  state?: string;
  flowId?: string;
}

export interface LlmProviderConnectionResult {
  success: boolean;
  provider?: LlmProviderEntry;
  models: LlmProviderModel[];
  error?: string;
}

export interface LlmProviderAccountStatus {
  providerId: LlmProviderId;
  state: 'signed-out' | 'pending' | 'connected' | 'failed' | 'unavailable';
  available: boolean;
  connected: boolean;
  message?: string;
  error?: string;
  accountLabel?: string;
  planLabel?: string;
  expiresAt?: string;
  authUrl?: string;
  verificationUri?: string;
  userCode?: string;
  requiresCodeInput?: boolean;
  models?: LlmProviderModel[];
}
