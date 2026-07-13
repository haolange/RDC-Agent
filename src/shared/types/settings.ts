import type { AgentRole } from './agent';
import type { AgentManifestDraft, AgentManifestSettings } from './agentManifest';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimeSkillDescriptor,
} from './agentRuntime';

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
  | 'qwen-account'
  | 'iflow'
  | 'longcat'
  | 'opencode-zen'
  | 'together-ai'
  | 'fireworks-ai'
  | 'novita-ai'
  | 'synthetic'
  | 'chutes'
  | 'lm-studio'
  | 'nvidia-nim'
  | 'github-models'
  | 'ollama-cloud'
  | 'minimax-account'
  | 'opencode-go'
  | 'cline';
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
export type LlmProviderLifecycleStatus = 'stable' | 'beta' | 'deprecated' | 'sunset';
export type LlmProviderAvailabilityState = 'available' | 'unavailable' | 'unknown';

export interface LlmProviderAvailability {
  state: LlmProviderAvailabilityState;
  reason?: string;
}

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

export type LlmProviderCatalogOwnership = 'app-managed' | 'user-managed';

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
export type LlmProviderModelAvailability = 'available' | 'unavailable' | 'unknown';
export type LlmProviderModelDiscoveryStrategy =
  | 'openai-compatible'
  | 'anthropic'
  | 'anthropic-candidate-validation'
  | 'google-ai-studio'
  | 'azure-openai'
  | 'ollama-tags'
  | 'account-catalog'
  | 'grok-account-catalog'
  | 'opencode-go-catalog'
  | 'cline-catalog'
  | 'minimax-account-catalog'
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
  /** Opt-in: Markdown syntax highlight + Write/Preview in composer; also renders user bubbles as Markdown. */
  composerMarkdown: boolean;
  /** Opt-in: use pointer cursor on interactive elements instead of the system default arrow. */
  usePointerCursors: boolean;
  /** UI memory: whether Context breakdown popover details are expanded. Driven by popover toggle only. */
  contextBreakdownExpanded: boolean;
}

export interface ProfileSettings {
  nickname: string;
  avatarPath?: string;
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
  userRdxRoot: string;
  settingsPath: string;
  instructionsPath: string;
  agentsPath: string;
  profileStatePath: string;
  logsPath: string;
  logPath: string;
  projectsPath: string;
  knowledgePath: string;
  policiesPath: string;
  skillsPath: string;
  mcpPath: string;
  secretsPath: string;
}

export interface LlmProviderModel {
  id: string;
  label: string;
  enabled: boolean;
  /** Proven alternate ids that resolve to this canonical model id. */
  aliases?: string[];
  availability?: LlmProviderModelAvailability;
  availabilityReason?: string;
}

export interface LlmProviderEntry {
  id: LlmProviderId;
  /** Stable local account key. It rotates when the credential identity changes. */
  activeAccountId?: string;
  /** Account identities retained per auth surface; `activeAccountId` projects the selected mode. */
  authAccountIds?: Partial<Record<LlmProviderAuthMode, string>>;
  protocol: LlmProviderProtocol;
  authMode: LlmProviderAuthMode;
  authModeOptions?: LlmProviderAuthMode[];
  authModeAvailability?: Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>>;
  hasStoredSecretByAuthMode?: Partial<Record<LlmProviderAuthMode, boolean>>;
  configuredAuthMode?: LlmProviderAuthMode;
  lifecycleStatus: LlmProviderLifecycleStatus;
  providerAvailability: LlmProviderAvailability;
  category: LlmProviderCategory;
  catalogOwnership: LlmProviderCatalogOwnership;
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
  protocolBaseUrls?: Partial<Record<LlmProviderProtocol, string>>;
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
  authModeOptions?: LlmProviderAuthMode[];
  authModeAvailability?: Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>>;
  lifecycleStatus: LlmProviderLifecycleStatus;
  providerAvailability: LlmProviderAvailability;
  category: LlmProviderCategory;
  catalogOwnership: LlmProviderCatalogOwnership;
  label: string;
  baseUrlEditable?: boolean;
  protocolEditable?: boolean;
  protocolOptions?: LlmProviderProtocol[];
  protocolBaseUrls?: Partial<Record<LlmProviderProtocol, string>>;
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

export interface RuntimeResourceCatalog {
  availableSkills: AgentRuntimeSkillDescriptor[];
  availableMcpServers: AgentRuntimeMcpDescriptor[];
  diagnostics: SettingsDiagnostic[];
}

export interface AppSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  llm: LlmSettings;
  agents: AgentManifestSettings;
  resourceCatalog: RuntimeResourceCatalog;
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
}>;

export interface LlmProviderDraftRequest {
  providerId: LlmProviderId;
  authMode?: LlmProviderAuthMode;
  apiKey?: string;
  baseUrl?: string;
  protocol?: LlmProviderProtocol;
}

export interface LlmProviderAccountLoginStartRequest {
  providerId: LlmProviderId;
  authMode?: LlmProviderAuthMode;
  accountLoginMode?: LlmProviderAccountLoginMode;
  accountRegion?: LlmProviderAccountRegion;
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
  discoveryDiagnostic?: {
    status: 'matched' | 'no-supported-models';
    discoveredModelCount: number;
    matchedModelCount: number;
    filteredModelCount: number;
  };
  error?: string;
}

export type LlmProviderAccountLoginMode = 'browser' | 'device';
export type LlmProviderAccountRegion = 'global' | 'cn';

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
  authorizationMode?: LlmProviderAccountLoginMode;
  diagnostic?: LlmProviderAccountDiagnostic;
  requestedScopes?: string;
  redirectUri?: string;
  models?: LlmProviderModel[];
}
