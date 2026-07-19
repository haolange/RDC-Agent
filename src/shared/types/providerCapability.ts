import type {
  ConversationTurnControls,
  ReasoningControl,
  ResolvedReasoningSelection,
} from './modelCapability';
import type {
  ProviderSurfaceManifest,
} from '../provider-catalog/catalogManifestSchema';
import type { ProviderAdapterId } from '../provider-catalog/implementationRegistry';
import type {
  BooleanControlDefinition,
  CatalogJsonObject,
  CatalogJsonPrimitive,
  CatalogJsonValue,
  ExecutionBinding,
  ModelManifest,
  ModelModeAction as CatalogModelModeAction,
  ModelPresencePolicy,
  ProviderContractBundle,
} from '../provider-catalog/modelManifestSchema';
import type {
  LlmProviderLifecycleStatus,
  LlmProviderProtocol,
} from './settings';

export type JsonPrimitive = CatalogJsonPrimitive;
export type JsonValue = CatalogJsonValue;
export type JsonObject = CatalogJsonObject;

export type EntitlementState = 'granted' | 'denied' | 'unknown';
export type EffectiveAvailability = 'available' | 'unavailable' | 'unknown';

export interface ProviderAccountKey {
  providerId: string;
  accountId: string;
}

export type CapabilityState =
  | { state: 'supported' }
  | { state: 'unsupported'; reason?: string }
  | { state: 'unknown' };

export type TierActivation =
  | { kind: 'implicit' }
  | { kind: 'header'; headers: Record<string, string> }
  | { kind: 'body'; patch: JsonObject };

export interface ContextTier {
  id: string;
  label: string;
  maxPromptTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  activation: TierActivation;
  costMultiplier?: number;
  entitlement: EntitlementState;
}

export interface ModelRoute {
  protocol: LlmProviderProtocol;
  baseUrl?: string;
  headers?: Record<string, string>;
  contracts?: ProviderContractBundle;
  source: 'model' | 'user' | 'catalog';
}

/** A route admitted for this exact model, independent from provider-wide protocol support. */
export interface ModelRouteOption {
  id: string;
  label?: string;
  route: ModelRoute;
  routeRevision?: string;
  availability: EffectiveAvailability;
  unavailableReason?: string;
  protocolOwner?: string;
  endpointOwner?: string;
  authMode?: import('./settings').LlmProviderAuthMode;
  requiredConnectionFieldIds?: string[];
}

/** Picker visibility is independent from whether this model is another model's execution target. */
export interface ModelSelection {
  pickerVisibility: 'primary' | 'internal';
  relatedPrimaryModelIds?: string[];
}

export type ControlDefinition = BooleanControlDefinition;
export type ModelModeAction = CatalogModelModeAction;
export type ExecutionBindingDefinition = ExecutionBinding;
export type ModelPresence = ModelPresencePolicy;

export type ResolvedControlState =
  | 'selectable'
  | 'fixed'
  | 'blocked'
  | 'unsupported'
  | 'unknown'
  | 'provider-managed';

export interface ResolvedBooleanControlCapability {
  state: ResolvedControlState;
  value: boolean;
  defaultValue: boolean;
  disabled: boolean;
  reason?: string;
  entitlement?: EntitlementState;
  bindingId?: string;
  effectiveModelId?: string;
  tierId?: string;
}

export interface ResolvedModelControls {
  fast: ResolvedBooleanControlCapability;
  context1m: ResolvedBooleanControlCapability;
  reasoning: ReasoningControl;
  catalogRevision?: string;
  routeRevision?: string;
}

export interface ExecutionBindingResolution {
  state: 'available' | 'blocked' | 'unknown';
  reason?: string;
  effectiveModelId?: string;
}

export type CapabilityEvidenceSource =
  | 'catalog'
  | 'discovery'
  | 'overlay'
  | 'entitlement'
  | 'observed'
  | 'maintained-surface'
  | 'user';

export interface CapabilityEvidence {
  field: string;
  value?: JsonValue;
  source: CapabilityEvidenceSource;
  sourceKind?:
    | 'user-control-panel'
    | 'live-catalog'
    | 'runtime-observation'
    | 'provider-control-plane'
    | 'provider-docs'
    | 'upstream-implementation'
    | 'models.dev'
    | 'opencode'
    | 'hermes'
    | 'rdc-agent'
    | 'user';
  observedAt: string;
  refreshedAt?: string;
  sourceRevision?: string;
  sourceHash?: string;
  surface?: string;
  accountScope?: string;
  surfaceBuild?: string;
  plan?: string;
  expiresAt?: string;
  protocol?: LlmProviderProtocol;
  detail?: string;
  conflict?: string;
}

export interface EffectiveModel {
  providerId: string;
  vendorId?: string;
  modelId: string;
  label: string;
  aliases: string[];
  /** User selection state; capability availability remains provider/account evidence. */
  enabled: boolean;
  route: ModelRoute;
  catalogRevision?: string;
  routeRevision?: string;
  routeOptions?: ModelRouteOption[];
  /** Account/provider/model-scoped route preference; an invalid id is retained so planning can fail closed. */
  preferredRouteOptionId?: string;
  selection?: ModelSelection;
  availability: EffectiveAvailability;
  unavailableReason?: string;
  presencePolicy: ModelPresencePolicy;
  contextTiers: ContextTier[];
  defaultBudgetTokens: number;
  cacheContract?: ProviderContractBundle['cache'];
  controls: {
    fast: BooleanControlDefinition;
    context1m: BooleanControlDefinition;
    reasoning: ReasoningControl;
  };
  executionBindings?: ExecutionBinding[];
  bindingResolutions?: Record<string, ExecutionBindingResolution>;
  resolvedControls?: ResolvedModelControls;
  toolCalling: CapabilityState;
  visionInput: CapabilityState;
  structuredOutput: CapabilityState;
  fixedTemperature?: number;
  quota?: { exhaustedUntil?: string; note?: string };
  provenance: CapabilityEvidence[];
}

export interface EffectiveCatalogSnapshot {
  providerId: string;
  accountId: string;
  protocol?: LlmProviderProtocol;
  catalogRevision: string;
  models: EffectiveModel[];
  generatedAt: string;
  stale: boolean;
  refreshing: boolean;
  lastRefreshError?: string;
}

export type ProviderStateMode = 'local-stateless' | 'provider-managed';
export type ToolLoopPhase = 'top-level' | 'assistant-tool-call' | 'tool-result' | 'terminal';

export interface StatePlan {
  mode: ProviderStateMode;
  carrier: ProviderContractBundle['state']['carrier'];
  store: boolean;
  reuseProviderState: boolean;
}

export interface CachePlan {
  enabled: boolean;
  mode: ProviderContractBundle['cache']['mode'];
  keyCarrier: ProviderContractBundle['cache']['keyCarrier'];
  breakpointCarrier: ProviderContractBundle['cache']['breakpointCarrier'];
  telemetry: ProviderContractBundle['cache']['telemetry'];
  ttl: ProviderContractBundle['cache']['ttl'];
}

export interface ToolLoopPlan {
  phase: ToolLoopPhase;
  pinned: true;
  artifactPolicy: ProviderContractBundle['toolLoop']['artifactPolicy'];
  artifactScope: ProviderContractBundle['toolLoop']['artifactScope'];
  ordering: ProviderContractBundle['toolLoop']['ordering'];
}

export interface StreamingPlan {
  transport: ProviderContractBundle['streaming']['transport'];
  outputIdentity: ProviderContractBundle['streaming']['outputIdentity'];
  usage: ProviderContractBundle['streaming']['usage'];
  errors: ProviderContractBundle['streaming']['errors'];
}

export type ContextTransitionStrategy =
  | 'exact-continuation'
  | 'provider-managed'
  | 'semantic-replay'
  | 'structured-handoff'
  | 'fresh-chain';

export interface ContextTransitionPlan {
  strategy: ContextTransitionStrategy;
  portable: boolean;
  reason: string;
}

export interface ExecutionIdentity {
  schemaVersion: 1;
  providerId: string;
  credentialScopeHash: string;
  endpointHash: string;
  protocolFamily: LlmProviderProtocol;
  protocolDialect: string;
  protocolVersion: string;
  catalogRevision: string;
  routeRevision: string;
  selectedModelId: string;
  effectiveModelId: string;
  canonicalModelId: string;
  modelSnapshotId: string;
  compatibilityGroup: string;
  bindingIds: string[];
  variantKey: string;
  reasoningMode: ResolvedReasoningSelection['selection'];
  contextMode: 'normal' | 'one-million';
  stateMode: ProviderStateMode;
  artifactFormat: string;
  artifactVersion: string;
  contractHash: string;
  toolLoopPhase: ToolLoopPhase;
  fingerprint: string;
}
export interface RequestPlan {
  providerId: string;
  adapterId: ProviderAdapterId;
  catalogRevision: string;
  routeRevision: string;
  selectedModelId: string;
  effectiveModelId: string;
  appliedBindingIds: string[];
  modelSelection?: ModelSelection;
  route: ModelRoute;
  contracts: ProviderContractBundle;
  executionIdentity: ExecutionIdentity;
  statePlan: StatePlan;
  cachePlan: CachePlan;
  toolLoopPlan: ToolLoopPlan;
  streamingPlan: StreamingPlan;
  contextTransitionPlan: ContextTransitionPlan;
  headers: Record<string, string>;
  bodyPatch: JsonObject;
  /** Prompt/input budget after applying the selected context mode. */
  contextBudgetTokens: number;
  contextMode: 'normal' | 'one-million';
  /** Complete provider context window, including the output reserve. */
  contextWindowTokens: number;
  activeTierId: string;
  fastMode: boolean;
  reasoningWire: ResolvedReasoningSelection;
  temperature?: number;
}

export type RequestPlanningErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'NO_USABLE_CONTEXT_TIER'
  | 'PLAN_CONFLICT'
  | 'CONSTRAINT_REJECTED';

export interface ModelRouteRecommendation {
  providerId: string;
  modelId: string;
  label: string;
}

export type RequestPlanningResult =
  | {
      ok: true;
      plan: RequestPlan;
      controls: ConversationTurnControls;
      warnings: string[];
    }
  | {
      ok: false;
      code: RequestPlanningErrorCode;
      message: string;
      controls: ConversationTurnControls;
      recommendations?: ModelRouteRecommendation[];
    };

export type ProviderLifecycleStatus = LlmProviderLifecycleStatus;
export type ProviderSurfaceAuthMode = 'none' | 'api-key' | 'oauth' | 'device' | 'environment' | 'local';

export interface ProviderAvailability {
  state: EffectiveAvailability;
  reason?: string;
}

export interface DiscoveryFieldMapping {
  id: string;
  label?: string;
  aliases?: string;
  contextWindow?: string;
  contextWindowKind?: 'prompt' | 'total';
  maxOutputTokens?: string;
  protocol?: string;
  modality?: string;
  toolCalling?: DiscoveryCapabilityMapping;
  visionInput?: DiscoveryCapabilityMapping;
  structuredOutput?: DiscoveryCapabilityMapping;
}

export interface DiscoveryCapabilityMapping {
  path: string;
  equals?: JsonPrimitive;
  includes?: JsonPrimitive;
}

export interface DiscoveryRouteRule {
  allowPatterns: string[];
  protocol: LlmProviderProtocol;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface DiscoveryAdmission {
  allowPatterns?: string[];
  denyPatterns?: string[];
  allowedModalities?: string[];
  requireContextWindow?: boolean;
}

export type DiscoveryStrategy = ProviderSurfaceManifest['discovery']['strategy'];
export type CatalogModelDefinition = ModelManifest;
export type ProviderSurfaceRoute = ProviderSurfaceManifest['routes'][number];
export type ProviderProtocolOverride = ProviderSurfaceManifest['protocolOverrides'][number];
export type ProviderSurfaceDefinition = ProviderSurfaceManifest;
