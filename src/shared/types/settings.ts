import type { AgentRole } from './agent';
import type { AgentManifestSettings } from './agentManifest';
import type { ReasoningSelection } from './modelCapability';

export type AppTheme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type ThemeVariant = ResolvedTheme;
export type AppLanguage = 'zh-CN' | 'en';
export type FontScale = 'small' | 'medium' | 'large';
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
type LlmProviderLifecycleStatus = 'stable' | 'beta' | 'retiring' | 'sunset';
type LlmProviderAvailabilityState = 'available' | 'unavailable' | 'unknown';

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
type LlmProviderEndpointClass =
  | 'first-party'
  | 'third-party-gateway'
  | 'cloud-hosted'
  | 'coding-plan'
  | 'account-surface'
  | 'local-service'
  | 'user-endpoint';

type LlmProviderConnectionFieldKind = 'secret' | 'text' | 'url' | 'region' | 'path';

export interface LlmProviderConnectionField {
  id: string;
  label: string;
  kind: LlmProviderConnectionFieldKind;
  required: boolean;
  environmentVariable?: string;
  placeholder?: string;
  valuePrefix?: string;
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

interface LlmProviderCatalogProvenance {
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
type LlmProviderCapability =
  | 'chat'
  | 'tool-calling'
  | 'structured-output'
  | 'reasoning'
  | 'prompt-cache'
  | 'vision-input'
  | 'model-discovery';
export type LlmProviderConnectionStatus = 'unconfigured' | 'verified' | 'failed' | 'unavailable';
type LlmProviderModelAvailability = 'available' | 'unavailable' | 'unknown';
export interface SidebarLayoutPreference {
  collapsed: boolean;
  width: number;
  expandedWidth: number;
}

interface TerminalLayoutPreference {
  height: number;
}

/** Desktop BrowserWindow geometry. Restored on launch; ignored by Browser QA. */
export interface WindowLayoutPreference {
  width: number;
  height: number;
  x: number;
  y: number;
  isMaximized: boolean;
}

export interface LayoutPreferences {
  leftSidebar: SidebarLayoutPreference;
  rightPanel: SidebarLayoutPreference;
  terminal: TerminalLayoutPreference;
  window: WindowLayoutPreference;
}

/** `latest` opens only the step that is running now; `all` opens every step's actions. */
export type WorkProcessExpansion = 'latest' | 'all';

export interface UiPreferences {
  theme: AppTheme;
  language: AppLanguage;
  fontScale: FontScale;
  /** Opt-in: Markdown syntax highlight + Write/Preview in composer; also renders user bubbles as Markdown. */
  composerMarkdown: boolean;
  /** UI memory: whether the context usage sheet's details are expanded. Driven by its disclosure only. */
  contextBreakdownExpanded: boolean;
  /** Which Working steps open by default; a user's own toggle always wins. */
  workProcessExpansion: WorkProcessExpansion;
  /** Independent Light / Dark chrome themes for Settings → Appearance. */
  chromeThemes: ChromeThemesConfig;
}

export interface ProfileSettings {
  nickname: string;
  avatarPath?: string;
}

export interface RdcCliInvokerSettings {
  enabled: boolean;
  command: string;
  argsPrefix: string[];
  workingDirectory: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface CodeInterpreterSettings {
  enabled: boolean;
  command: string;
  argsPrefix: string[];
  timeoutMs: number;
  env: Record<string, string>;
  artifactsEnabled: boolean;
}

/** Machine-local agent shell override. Project scope cannot replace this. */
export interface AgentShellSettings {
  /** Absolute executable path. Empty = auto-detect. */
  executable: string;
}

type AgentShellKind = 'pwsh' | 'windows-powershell' | 'zsh' | 'bash' | 'sh';

export type ResolvedShellSnapshot =
  | {
      ok: true;
      kind: AgentShellKind;
      version: string;
      versionMajor: number | null;
      executable: string;
      label: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface ToolingSettings {
  rdcCli: RdcCliInvokerSettings;
  codeInterpreter: CodeInterpreterSettings;
  shell: AgentShellSettings;
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

export interface AgentRuntimeContextSettings {
  compactionThresholdPercent: number;
}

export interface AgentRuntimeSettings {
  permissions: AgentPermissionSettings;
  context: AgentRuntimeContextSettings;
}

export interface AppRuntimePaths {
  userRdcRoot: string;
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
  accountLogin?: LlmProviderAccountLogin;
  accountLabel?: string;
  planLabel?: string;
  oauthExpiresAt?: string;
  oauthRefreshAvailable?: boolean;
  unavailableReason?: string;
  isConfigured: boolean;
  capabilities?: LlmProviderCapability[];
}

/** A model row as the user owns it: the choices, plus the label and aliases of a row the catalog does not list. */
export interface ProviderModelChoice extends LlmProviderModelPreference {
  label?: string;
  aliases?: string[];
}

/** The model choices of one provider; the connection and every other field stay as main has them. */
export interface ProviderDefinitionSaveRequest {
  providerId: LlmProviderId;
  /** `providerConnectionIdentity` of the connection the choices were made on; another connection supersedes them. */
  connectionIdentity: string;
  models: ProviderModelChoice[];
  clientRevision: number;
}

type ProviderDefinitionSaveStatus = 'committed' | 'superseded' | 'failed';

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
  /** The settings revision a committed save produced; the renderer's `settings:changed` for it needs no read. */
  revision?: number;
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
  accountLogin?: LlmProviderAccountLogin;
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

interface LlmSettings {
  providers: LlmProviderEntry[];
  /** Read-only runtime projection derived from canonical `.agent.md` manifests. */
  agentRoutes: LlmAgentRoute[];
}

/** The fields of a provider entry that are catalog facts; `settings:getProviderCatalog` sends them once. */
export const LLM_PROVIDER_CATALOG_FIELDS = [
  'protocol', 'routeCount', 'authModeOptions', 'authModeAvailability', 'lifecycleStatus', 'providerAvailability',
  'category', 'catalogOwnership', 'serviceOperator', 'endpointClass', 'catalogProvenance', 'label', 'connectionSchema',
  'baseUrlEditable', 'recommendedModels', 'docsUrl', 'accountLogin', 'capabilities', 'apiKey',
] as const satisfies ReadonlyArray<keyof LlmProviderEntry>;

/** A provider as `settings:get` sends it: its connection and the user's state, without the catalog facts. */
export type LlmProviderConnectionState = Omit<LlmProviderEntry, (typeof LLM_PROVIDER_CATALOG_FIELDS)[number]>;

/**
 * `settings:get`: the user's settings and connection state at one revision. The renderer joins the connections with
 * the catalog it read once and computes the Agent model choices from the effective catalogs.
 */
export interface SettingsView {
  revision: number;
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  agentModels: AgentModelSettings;
  llm: { connections: LlmProviderConnectionState[]; agentRoutes: LlmAgentRoute[] };
  /** The Agents of the project main has selected (`projectId`), or the user's alone when none is selected. */
  agents: AgentManifestSettings & { projectId: string | null };
  resourceCatalog: RuntimeResourceCatalog;
  paths: AppRuntimePaths;
}

/** A section of the user's settings file, or the global instructions Settings also writes. */
export type SettingsFileSection =
  | 'appearance'
  | 'layout'
  | 'profile'
  | 'tooling'
  | 'agentRuntime'
  | 'agentModels'
  | 'providers'
  | 'globalInstructions';

/** Broadcast on `settings:changed` after every committed settings write. */
export interface SettingsChangedPayload {
  revision: number;
  sections: SettingsFileSection[];
}

export interface SettingsDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

interface RuntimeResourceCatalog {
  diagnostics: SettingsDiagnostic[];
}

/** One Agent's model choice; an omitted field falls back to the default binding. */
export interface AgentModelBinding {
  /** Canonical `provider:model`. */
  model?: string;
  reasoningLevel?: ReasoningSelection;
}

/** Which model and reasoning level each Agent uses. Stored in user settings only; projects cannot set models. */
export interface AgentModelSettings {
  default: AgentModelBinding;
  byAgent: Record<string, AgentModelBinding>;
}

export interface AppSettings {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  llm: LlmSettings;
  agentModels: AgentModelSettings;
  agents: AgentManifestSettings;
  resourceCatalog: RuntimeResourceCatalog;
  paths: AppRuntimePaths;
}

/** The fields of one Agent model binding, each set and cleared on its own. */
type AgentModelBindingField =
  | { field: 'model'; value: string }
  | { field: 'reasoningLevel'; value: ReasoningSelection };

/**
 * One change `settings:patch` applies. A section op merges its partial value into that section (nested objects one
 * level down); Agent model ops change one field of one binding, so concurrent edits of different fields never
 * overwrite each other.
 */
export type SettingsPatchOp =
  | { op: 'appearance'; value: Partial<UiPreferences> }
  | { op: 'layout'; value: Partial<{
    leftSidebar: Partial<SidebarLayoutPreference>;
    rightPanel: Partial<SidebarLayoutPreference>;
    terminal: Partial<TerminalLayoutPreference>;
    window: Partial<WindowLayoutPreference>;
  }> }
  | { op: 'profile'; value: Partial<ProfileSettings> }
  | { op: 'tooling'; value: Partial<{
    rdcCli: Partial<RdcCliInvokerSettings>;
    codeInterpreter: Partial<CodeInterpreterSettings>;
    shell: Partial<AgentShellSettings>;
  }> }
  | { op: 'agentRuntime'; value: Partial<{
    permissions: Partial<AgentPermissionSettings>;
    context: Partial<AgentRuntimeContextSettings>;
  }> }
  | { op: 'globalInstructions'; value: string }
  /** Sets one field of the default binding; null clears it. */
  | ({ op: 'agentModels.setDefault' } & (
    | { field: 'model'; value: string | null }
    | { field: 'reasoningLevel'; value: ReasoningSelection | null }))
  | ({ op: 'agentModels.setAgentField'; agentId: string } & AgentModelBindingField)
  | { op: 'agentModels.clearAgentField'; agentId: string; field: AgentModelBindingField['field'] };

/** The Agent model bindings a patch changed; null means the Agent no longer has its own binding. */
export interface AgentModelChanges {
  default?: AgentModelBinding;
  byAgent?: Record<string, AgentModelBinding | null>;
}

/** What `settings:patch` committed: each changed section as stored, and only the Agent model bindings it changed. */
export interface SettingsPatchChanges {
  appearance?: UiPreferences;
  layout?: LayoutPreferences;
  profile?: ProfileSettings;
  tooling?: ToolingSettings;
  agentRuntime?: AgentRuntimeSettings;
  agentModels?: AgentModelChanges;
  /** The instructions are stored as sent, trimmed; the text is not echoed back. */
  globalInstructions?: true;
}

export interface SettingsPatchResult {
  /** The settings revision after the commit; unchanged when the ops changed nothing. */
  revision: number;
  changed: SettingsPatchChanges;
}

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
}

/** How a provider's account sign-in works, projected from its manifest for the connect dialog. */
interface LlmProviderAccountLogin {
  mode: LlmProviderAccountLoginMode;
  /** The browser flow ends with a code the person pastes back into the app. */
  codeInput: boolean;
}

export interface LlmProviderAccountLoginFinishRequest {
  providerId: LlmProviderId;
  code?: string;
  state?: string;
  flowId?: string;
}

/** Connection failures the person can act on; the renderer translates each with its params. */
export type ProviderConnectionErrorCode =
  | 'credentials-rejected'
  | 'discovery-unavailable'
  | 'service-unavailable'
  | 'http-failed'
  | 'no-routable-models'
  | 'not-in-catalog'
  | 'unknown-provider'
  | 'api-key-required'
  | 'base-url-required'
  | 'discovery-missing'
  | 'timeout'
  | 'failed';

export type ProviderConnectionErrorParams = Record<string, string | number>;

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
  errorCode?: ProviderConnectionErrorCode;
  errorParams?: ProviderConnectionErrorParams;
}

export type LlmModelCapabilityProbeMode = 'default' | 'max-context' | 'fast' | 'fast-max-context';

export interface LlmModelCapabilityProbeRequest {
  providerId: LlmProviderId;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
}

export interface LlmModelCapabilityProbeResult {
  success: boolean;
  status: 'verified' | 'inconclusive' | 'denied' | 'failed' | 'cancelled';
  failureKind?: 'entitlement-denied' | 'authentication-failed' | 'quota-exhausted' | 'route-unavailable' | 'tools-unsupported' | 'unknown';
  requestSent: boolean;
  detail?: string;
  detailCode?: 'fast-tier-default' | 'fast-tier-missing' | 'fast-tier-other';
  evidence?: {
    protocol: LlmProviderProtocol;
    effectiveModelId: string;
    observedAt: string;
    observedModelId?: string;
    requestedServiceTier?: string;
    serviceTier?: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      speed?: 'standard' | 'fast';
    };
  };
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
