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
  | 'github-copilot'
  | 'grok-account'
  | 'gemini-account'
  | 'qwen-account';
export type LlmProviderId = BuiltinLlmProviderId | (string & {});

/**
 * Wire-protocol kind — describes the underlying request/response protocol that the
 * provider speaks at the HTTP layer. This is independent of how a user authenticates
 * (see `LlmProviderAuthMode`) and where the provider is shown in the catalog UI
 * (see `LlmProviderCatalogGroup`).
 *
 * Values:
 * - `openrouter`           : OpenRouter's hosted gateway (OpenAI-style chat completions with provider routing).
 * - `openai-compatible`    : OpenAI Chat Completions / Responses API contract.
 * - `anthropic`            : Anthropic Messages API contract.
 * - `google-ai-studio`     : Google Generative Language (AI Studio / Gemini) API contract.
 * - `azure-openai`         : Azure-hosted OpenAI deployments (path/version/auth quirks vs raw OpenAI).
 * - `bedrock`              : AWS Bedrock invocation API (signed via AWS credential chain).
 * - `vertex`               : Google Cloud Vertex AI (signed via GCP credential chain).
 * - `ollama`               : Local Ollama runtime (OpenAI-style endpoint exposed by ollama serve).
 */
export type LlmProviderKind =
  | 'openrouter'
  | 'openai-compatible'
  | 'anthropic'
  | 'google-ai-studio'
  | 'azure-openai'
  | 'bedrock'
  | 'vertex'
  | 'ollama';

/**
 * Authentication mode — describes HOW the user authenticates to the provider.
 * Orthogonal to `LlmProviderKind` (wire protocol) and `LlmProviderCatalogGroup`
 * (UI grouping).
 *
 * - `api-key`     : User-supplied API key sent as a bearer/header.
 * - `local`       : Local runtime, no remote credentials needed.
 * - `account`     : OAuth / Device Flow login that yields a refreshable account session.
 * - `environment` : Resolved from ambient environment / cloud credential chain (AWS, GCP).
 */
export type LlmProviderAuthMode = 'api-key' | 'local' | 'account' | 'environment';

/**
 * Product-oriented catalog grouping — decides WHERE a provider is shown in the
 * Settings UI. Independent of `authMode` (HOW to authenticate) and `kind`
 * (wire protocol).
 *
 * - `account`              : Login-authorized providers (OAuth / Device Flow).
 * - `openai-compatible`    : Endpoints speaking the OpenAI Chat Completions contract.
 * - `anthropic-compatible` : Endpoints speaking the Anthropic Messages contract.
 * - `cloud-platform`       : Cloud-platform managed offerings (Azure / Bedrock / Vertex).
 * - `local`                : Local runtimes (Ollama and similar).
 * - `image`                : Image-generation skeleton group (no concrete providers in this iteration).
 */
export type LlmProviderCatalogGroup =
  | 'account'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'cloud-platform'
  | 'local'
  | 'image';

/**
 * Provider capability declaration — feature flags that downstream code can
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

export interface ToolingSettings {
  rdxCli: RdxCliInvokerSettings;
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
  capabilities?: LlmProviderCapability[];
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
  tooling: ToolingSettings;
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
