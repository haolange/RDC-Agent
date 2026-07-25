import type { AgentRole } from './agent';
import type { AgentManifestSettings } from './agentManifest';
import type {
  AgentRuntimeMcpDescriptor,
  AgentRuntimeSkillDescriptor,
} from './agentRuntime';
import type { ReasoningSelection } from './modelCapability';

export type AppTheme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type ThemeVariant = ResolvedTheme;
export type AppLanguage = 'zh-CN' | 'en';
export type FontScale = 'small' | 'medium' | 'large';
export type ReduceMotionPreference = 'system' | 'on' | 'off';
export type ThemePresetId =
  | 'rdc'
  | 'absolutely'
  | 'ayu'
  | 'catppuccin'
  | 'dracula'
  | 'everforest'
  | 'github'
  | 'gruvbox'
  | 'linear';

export interface ThemeChromeFonts {
  ui: string | null;
  code: string | null;
}

/** Per-variant Appearance chrome (Light and Dark are independent). */
export interface ThemeChromeConfig {
  presetId: ThemePresetId;
  accent: string;
  surface: string;
  ink: string;
  /** 0–100; default 45. Raises ink/surface separation. */
  contrast: number;
  fonts: ThemeChromeFonts;
}

export interface ChromeThemesConfig {
  light: ThemeChromeConfig;
  dark: ThemeChromeConfig;
}
export type BuiltinLlmProviderId =
  | 'openrouter'
  | 'openai'
  | 'openai-eu'
  | 'openai-us'
  | 'anthropic'
  | 'anthropic-thirdparty'
  | 'azure'
  | 'azure-cognitive-services'
  | 'amazon-bedrock'
  | 'google-vertex'
  | 'google-vertex-anthropic'
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
  | 'opencode-go'
  | 'cline'
  | 'cline-pass'
  | 'nous';
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
  | 'AzureOpenAIResponses'
  | 'GoogleInteractions'
  | 'GoogleGemini'
  | 'GoogleVertexGemini'
  | 'GoogleVertexAnthropic'
  | 'GitLabDuo'
  | 'SapAiCoreOrchestration'
  | 'SapAiCoreFoundationModels'
  | 'OllamaOpenAICompatibleChatCompletions'
  | 'MistralConversations'
  | 'BedrockConverseStream';

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
export type LlmProviderAuthMode = 'none' | 'api-key' | 'local' | 'account' | 'environment';
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
  | 'coding-token-plan'
  | 'compatible-access'
  | 'local';

export type LlmProviderCatalogOwnership = 'app-managed' | 'provider-managed' | 'user-managed';

/** Provider operating and endpoint facts are explicit and never inferred from UI grouping. */
export type LlmProviderEndpointClass =
  | 'first-party'
  | 'third-party-gateway'
  | 'cloud-hosted'
  | 'coding-plan'
  | 'account-surface'
  | 'local-service'
  | 'user-endpoint';

export type LlmProviderConnectionFieldKind = 'secret' | 'text' | 'url' | 'region' | 'path';

export interface LlmProviderConnectionField {
  id: string;
  label: string;
  kind: LlmProviderConnectionFieldKind;
  required: boolean;
  environmentVariable?: string;
  placeholder?: string;
}

export interface LlmProviderConnectionSchema {
  fields: LlmProviderConnectionField[];
  /** Secret field used as the HTTP provider credential by the selected adapter. */
  primarySecretFieldId?: string;
  /** At least one alternative must be complete; fields may otherwise remain optional. */
  credentialAlternatives?: Array<{
    id: string;
    fieldIds: string[];
    label?: string;
    description?: string;
    /** Uses the platform credential chain without persisting an additional field. */
    ambient?: boolean;
  }>;
  /** Non-secret connection fields projected into the frozen request route. */
  headerMappings?: Array<{ fieldId: string; header: string; prefix?: string }>;
  /** Template variables use connection field ids, for example `${DATABRICKS_HOST}`. */
  endpointTemplate?: string;
}

export interface LlmProviderCatalogProvenance {
  source:
    | 'user-control-panel'
    | 'live-catalog'
    | 'runtime-observation'
    | 'provider-control-plane'
    | 'provider-docs'
    | 'upstream-implementation'
    | 'models.dev'
    | 'opencode'
    | 'hermes'
    | 'rdc-agent';
  revision: string;
  observedAt?: string;
  refreshedAt: string;
  identityId?: string;
  surface?: string;
  accountScope?: string;
  surfaceBuild?: string;
  plan?: string;
}

/**
 * Provider capability declaration - feature flags that downstream code can
 * consult before attempting capability-gated behaviour (e.g. requesting tool
 * calls, structured outputs, vision input, etc.).
 * Image/video generation is out of product scope and must not appear here.
 */
export type LlmProviderCapability =
  | 'chat'
  | 'tool-calling'
  | 'structured-output'
  | 'reasoning'
  | 'prompt-cache'
  | 'vision-input'
  | 'model-discovery';
export type LlmProviderConnectionStatus = 'unconfigured' | 'verified' | 'failed' | 'unavailable';
export type LlmProviderModelAvailability = 'available' | 'unavailable' | 'unknown';
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
  /** Reduce UI motion: match OS, force on, or force off. */
  reduceMotion: ReduceMotionPreference;
  /** Independent Light / Dark chrome themes for Settings → Appearance. */
  chromeThemes: ChromeThemesConfig;
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

export type RdxActionId =
  | 'openCapture'
  | 'openRemoteCapture'
  | 'connectRemote'
  | 'closeRuntime'
  | 'openPreview';

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

export interface LlmProviderModelPreference {
  id: string;
  /** User-owned admission switch; provider availability remains separate. */
  enabled: boolean;
  /** Optional user override. Missing means the effective catalog default wins. */
  defaultReasoningSelection?: ReasoningSelection;
  /** Optional client-side prompt budget. It never changes a provider context tier. */
  defaultBudgetTokens?: number;
  /** User-owned route selection for this exact provider surface and model. */
  preferredRouteOptionId?: string;
}

export interface LlmProviderModel extends LlmProviderModelPreference {
  label: string;
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
  /** Number of compiled surface routes; >1 means multi-protocol. */
  routeCount?: number;
  authMode: LlmProviderAuthMode;
  authModeOptions?: LlmProviderAuthMode[];
  authModeAvailability?: Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>>;
  hasStoredSecretByAuthMode?: Partial<Record<LlmProviderAuthMode, boolean>>;
  configuredAuthMode?: LlmProviderAuthMode;
  lifecycleStatus: LlmProviderLifecycleStatus;
  providerAvailability: LlmProviderAvailability;
  category: LlmProviderCategory;
  /** Company or platform operating the configured service endpoint. */
  serviceOperator: string;
  endpointClass: LlmProviderEndpointClass;
  catalogOwnership: LlmProviderCatalogOwnership;
  catalogProvenance: LlmProviderCatalogProvenance[];
  label: string;
  enabled: boolean;
  apiKey: string;
  secretRef?: string;
  /** Account-keyed secret references for providers requiring more than one credential. */
  secretRefs?: Record<string, string>;
  /** Persisted non-secret connection fields only; secret values never enter settings JSON. */
  connectionValues?: Record<string, string>;
  /** Renderer-safe presence projection for connection-schema secret fields. */
  hasStoredConnectionSecrets?: Record<string, boolean>;
  connectionSchema?: LlmProviderConnectionSchema;
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

export interface ProviderDefinitionSaveRequest {
  provider: LlmProviderEntry;
  clientRevision: number;
}

export type ProviderDefinitionSaveStatus = 'committed' | 'superseded' | 'failed';

export interface ProviderDefinitionCommitSnapshot {
  clientRevision: number;
  providerId: LlmProviderId;
  commitHash: string;
  provider: LlmProviderEntry | null;
  catalogRevision: string | null;
}

export interface ProviderDefinitionSaveResult {
  clientRevision: number;
  providerId: LlmProviderId;
  status: ProviderDefinitionSaveStatus;
  commitHash: string | null;
  provider: LlmProviderEntry | null;
  catalogRevision: string | null;
  lastSuccessful: ProviderDefinitionCommitSnapshot | null;
  error?: string;
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
  /** Number of compiled surface routes; >1 means multi-protocol. */
  routeCount?: number;
  authMode: LlmProviderAuthMode;
  authModeOptions?: LlmProviderAuthMode[];
  authModeAvailability?: Partial<Record<LlmProviderAuthMode, LlmProviderAvailability>>;
  lifecycleStatus: LlmProviderLifecycleStatus;
  providerAvailability: LlmProviderAvailability;
  category: LlmProviderCategory;
  serviceOperator: string;
  endpointClass: LlmProviderEndpointClass;
  catalogOwnership: LlmProviderCatalogOwnership;
  catalogProvenance: LlmProviderCatalogProvenance[];
  connectionSchema?: LlmProviderConnectionSchema;
  label: string;
  baseUrlEditable?: boolean;
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
  /** Read-only runtime projection derived from canonical `.agent.md` manifests. */
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
  }>;
  agents: Partial<{
    globalInstructions: string;
  }>;
}>;

export interface LlmProviderDraftRequest {
  providerId: LlmProviderId;
  authMode?: LlmProviderAuthMode;
  apiKey?: string;
  baseUrl?: string;
  protocol?: LlmProviderProtocol;
  /** Transient connection-field values; secret kinds are committed only to secret storage. */
  connectionValues?: Record<string, string>;
  /** User-owned fields only; discovery remains authoritative for identity and availability. */
  modelPreferences?: LlmProviderModelPreference[];
}

export interface LlmProviderAccountLoginStartRequest {
  providerId: LlmProviderId;
  authMode?: LlmProviderAuthMode;
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
  /**
   * Credential-scoped Effective Catalog account key written by this Test/Refresh.
   * When testing uncommitted secrets on an already-configured provider, this is
   * `anonymous:{providerId}` so the live account cache is not overwritten.
   */
  discoveryAccountId?: string;
  discoveryDiagnostic?: {
    status: 'matched' | 'no-supported-models';
    discoveredModelCount: number;
    matchedModelCount: number;
    filteredModelCount: number;
  };
  error?: string;
}

export type LlmModelCapabilityProbeMode = 'default' | 'one-million-context' | 'fast';

export interface LlmModelCapabilityProbeRequest {
  providerId: LlmProviderId;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
}

export interface LlmModelCapabilityProbeResult {
  success: boolean;
  status: 'verified' | 'inconclusive' | 'denied' | 'failed';
  requestSent: boolean;
  detail?: string;
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
  authorizationMode?: LlmProviderAccountLoginMode;
  diagnostic?: LlmProviderAccountDiagnostic;
  requestedScopes?: string;
  redirectUri?: string;
  models?: LlmProviderModel[];
}
