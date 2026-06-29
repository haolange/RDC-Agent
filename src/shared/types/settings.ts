import type { AgentRole } from './agent';
import type { AgentManifestDraft, AgentManifestSettings } from './agentManifest';
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
  | 'glm-cn-coding-plan'
  | 'glm-global-coding-plan'
  | 'kimi-coding-plan'
  | 'moonshot'
  | 'minimax-cn'
  | 'minimax-global'
  | 'minimax-cn-coding-plan'
  | 'minimax-global-coding-plan'
  | 'xiaomi-mimo'
  | 'xiaomi-mimo-token-plan'
  | 'bailian'
  | 'bailian-coding-plan'
  | 'bedrock'
  | 'vertex'
  | 'qwen'
  | 'volcengine'
  | 'volcengine-coding-plan'
  | 'vercel-ai-gateway'
  | 'manifest'
  | 'custom-endpoint'
  | 'litellm'
  | '302ai'
  | 'siliconflow'
  | 'ollama'
  | 'claude-account'
  | 'chatgpt-account'
  | 'github-copilot'
  | 'grok-account'
  | 'gemini-account'
  | 'qwen-account';
export type LlmProviderId = BuiltinLlmProviderId | (string & {});

/**
 * Wire protocol for the actual API request shape. This is independent of
 * authentication (`LlmProviderAuthMode`) and product catalog category
 * (`LlmProviderCategory`).
 */
export type LlmProviderProtocol =
  | 'OpenAICompatibleChatCompletions'
  | 'OpenAIResponses'
  | 'AnthropicMessages'
  | 'OpenRouterChatCompletions'
  | 'AzureOpenAIChatCompletions'
  | 'GoogleGemini'
  | 'AwsBedrock'
  | 'GoogleVertexAI'
  | 'OllamaOpenAICompatibleChatCompletions';

/**
 * Authentication mode - describes HOW the user authenticates to the provider.
 * Orthogonal to `LlmProviderProtocol` (wire protocol) and `LlmProviderCategory`
 * (UI grouping).
 *
 * - `api-key`     : User-supplied API key sent as a bearer/header.
 * - `local`       : Local runtime, no remote credentials needed.
 * - `account`     : OAuth / Device Flow login that yields a refreshable account session.
 * - `environment` : Resolved from ambient environment / cloud credential chain (AWS, GCP).
 */
export type LlmProviderAuthMode = 'api-key' | 'local' | 'account' | 'environment';

/**
 * User-visible product category. Categories describe provider source and
 * commercial shape; they must not be used to infer runtime protocol.
 */
export type LlmProviderCategory =
  | 'login-authorization'
  | 'official-direct'
  | 'cloud-platform'
  | 'official-compatible'
  | 'coding-token-plan'
  | 'third-party-compatible'
  | 'local'
  | 'image';

/**
 * Provider capability declaration - feature flags that downstream code can
 * consult before attempting capability-gated behaviour (e.g. requesting tool
 * calls, structured outputs, image generation, etc.).
 */
export type LlmProviderCapability =
  | 'chat'
  | 'tool-calling'
  | 'structured-output'
  | 'reasoning'
  | 'prompt-cache'
  | 'vision-input'
  | 'model-discovery'
  | 'image-generation'
  | 'video-generation';
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

export type RdxCliJsonMode = 'auto' | 'always';

export interface RdxCliInvokerSettings {
  enabled: boolean;
  command: string;
  argsPrefix: string[];
  workingDirectory: string;
  env: Record<string, string>;
  timeoutMs: number;
  catalogPath: string;
  jsonMode: RdxCliJsonMode;
}

export type RdxActionId = 'openCapture' | 'connectRemote' | 'closeRuntime' | 'openPreview';

export interface RdxShellActionSettings {
  enabled: boolean;
  command: string;
  args: string[];
  workingDirectory: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export type RdxActionSettingsMap = Record<RdxActionId, RdxShellActionSettings>;

export interface ToolingSettings {
  rdxCli: RdxCliInvokerSettings;
  rdxActions: RdxActionSettingsMap;
}

export type AgentPermissionMode =
  | 'default'
  | 'auto-review'
  | 'full-access'
  | 'custom';

export interface AgentPermissionSettings {
  mode: AgentPermissionMode;
  readableRoots: string[];
  writableRoots: string[];
  allowedCommandPrefixes: string[];
  deniedCommandPrefixes: string[];
}

export interface AgentRuntimeSettings {
  permissions: AgentPermissionSettings;
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
  protocol: LlmProviderProtocol;
  authMode: LlmProviderAuthMode;
  category: LlmProviderCategory;
  modelDiscovery: LlmProviderModelDiscoveryStrategy | null;
  label: string;
  enabled: boolean;
  apiKey: string;
  secretRef?: string;
  hasStoredSecret: boolean;
  baseUrl?: string;
  baseUrlEditable?: boolean;
  protocolEditable?: boolean;
  protocolOptions?: LlmProviderProtocol[];
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
  capabilities?: LlmProviderCapability[];
}

export interface LlmProviderCategoryDescriptor {
  id: LlmProviderCategory;
  label: string;
  description: string;
}

export interface LlmProviderProtocolDescriptor {
  id: LlmProviderProtocol;
  label: string;
  description: string;
  responseEndpointHint?: string;
}

export interface LlmProviderCatalogEntry {
  id: LlmProviderId;
  protocol: LlmProviderProtocol;
  authMode: LlmProviderAuthMode;
  category: LlmProviderCategory;
  label: string;
  baseUrlEditable?: boolean;
  protocolEditable?: boolean;
  protocolOptions?: LlmProviderProtocol[];
  recommendedModels: string[];
  docsUrl?: string;
  accountLoginConfigured?: boolean;
  unavailableReason?: string;
  capabilities?: LlmProviderCapability[];
}

export interface LlmProviderCatalogResponse {
  categories: LlmProviderCategoryDescriptor[];
  protocols: LlmProviderProtocolDescriptor[];
  providers: LlmProviderCatalogEntry[];
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
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  llm: LlmSettings;
  agents: AgentManifestSettings;
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
  tooling: Partial<{
    rdxCli: Partial<RdxCliInvokerSettings>;
    rdxActions: Partial<Record<RdxActionId, Partial<RdxShellActionSettings>>>;
  }>;
  agentRuntime: Partial<{
    permissions: Partial<AgentPermissionSettings>;
  }>;
  llm: Partial<{
    providers: LlmProviderEntry[];
    agentRoutes: LlmAgentRoute[];
  }>;
  agents: Partial<{
    definitions: AgentManifestDraft[];
    globalInstructions: string;
  }>;
  configuration: Partial<ConfigurationSettings>;
}>;

export interface LlmProviderDraftRequest {
  providerId: LlmProviderId;
  apiKey?: string;
  baseUrl?: string;
  protocol?: LlmProviderProtocol;
}

export interface LlmProviderAccountLoginStartRequest {
  providerId: LlmProviderId;
  oauthClientId?: string;
  accountLoginMode?: LlmProviderAccountLoginMode;
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

export type LlmProviderAccountLoginMode = 'browser' | 'device';

export interface LlmProviderAccountDiagnostic {
  stage: 'configuration' | 'metadata' | 'authorization' | 'callback' | 'token' | 'models' | 'refresh' | 'revoke';
  summary: string;
  detail?: string;
  providerError?: string;
  requestedScopes?: string;
  redirectUri?: string;
  checklist?: string[];
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
  oauthRefreshAvailable?: boolean;
  authUrl?: string;
  verificationUri?: string;
  userCode?: string;
  requiresCodeInput?: boolean;
  requiresClientId?: boolean;
  clientIdSource?: 'manual' | 'env' | 'stored';
  authorizationMode?: LlmProviderAccountLoginMode;
  diagnostic?: LlmProviderAccountDiagnostic;
  requestedScopes?: string;
  redirectUri?: string;
  models?: LlmProviderModel[];
}
