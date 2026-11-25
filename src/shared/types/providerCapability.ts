import type { ReasoningControl, ResolvedReasoningSelection } from './modelCapability';
import type { ProviderAdapterId } from '../provider-catalog/implementationRegistry';
import type { JsonObject, JsonValue } from '../utils/jsonValue';
import type { BooleanControlDefinition, ExecutionBinding, ModelCost, ModelPresencePolicy, ProviderContractBundle } from '../provider-catalog/modelManifestSchema';
import type { LlmProviderProtocol } from './settings';

export type EntitlementState = 'granted' | 'denied' | 'unknown';
export type EffectiveAvailability = 'available' | 'unavailable' | 'unknown';

export type CapabilityState =
  | { state: 'supported' }
  | { state: 'unsupported'; reason?: string }
  | { state: 'unknown' };

type TierActivation =
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

export interface CatalogModelRoute {
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
  route: CatalogModelRoute;
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
export type ExecutionBindingDefinition = ExecutionBinding;

type ResolvedControlState =
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
  maxContext: ResolvedBooleanControlCapability;
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
  route: CatalogModelRoute;
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
    maxContext: BooleanControlDefinition;
    reasoning: ReasoningControl;
  };
  executionBindings?: ExecutionBinding[];
  bindingResolutions?: Record<string, ExecutionBindingResolution>;
  resolvedControls?: ResolvedModelControls;
  toolCalling: CapabilityState;
  visionInput: CapabilityState;
  structuredOutput: CapabilityState;
  fixedTemperature?: number;
  cost?: ModelCost;
  quota?: { exhaustedUntil?: string; note?: string };
  provenance: CapabilityEvidence[];
}

export interface EffectiveCatalogSnapshot {
  scopeGeneration: string;
  projectionVersion: number;
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

/** Names the snapshot a catalog change applies to. */
export interface EffectiveCatalogBase {
  scopeGeneration: string;
  projectionVersion: number;
  catalogRevision: string;
}

/**
 * `llm:effectiveCatalogChanged`: one scope's catalog as a change against the snapshot main last handed out for that
 * scope. A reader holding that snapshot applies it; any other reader reads the catalog again.
 */
export interface EffectiveCatalogChange {
  /** The snapshot this change applies to; null when main handed out none, and `models.upsert` is the whole list. */
  base: EffectiveCatalogBase | null;
  /** The new snapshot's header. */
  snapshot: Omit<EffectiveCatalogSnapshot, 'models'>;
  models: {
    /** Models the base does not have, whole. */
    add: EffectiveModel[];
    /** Models of the base that changed, as the values that changed. A new `catalogRevision` alone is not a change. */
    update: EffectiveModelUpdate[];
    remove: string[];
    /** Every model id in order; present only when the order is not the base order without the removed ids, new ids last. */
    order?: string[];
  };
}

/** One changed value inside a model: the path to it and its new value; without a value the path is removed. */
export interface EffectiveModelValueChange {
  path: Array<string | number>;
  value?: unknown;
}

export interface EffectiveModelUpdate {
  modelId: string;
  changes: EffectiveModelValueChange[];
}

export type ProviderStateMode = 'local-stateless' | 'provider-managed';
export type ToolLoopPhase = 'top-level' | 'assistant-tool-call' | 'tool-result' | 'terminal';

interface StatePlan {
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

interface ToolLoopPlan {
  phase: ToolLoopPhase;
  pinned: true;
  artifactPolicy: ProviderContractBundle['toolLoop']['artifactPolicy'];
  artifactScope: ProviderContractBundle['toolLoop']['artifactScope'];
  ordering: ProviderContractBundle['toolLoop']['ordering'];
}

interface StreamingPlan {
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
  route: CatalogModelRoute;
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
  /** Complete provider context window. */
  contextWindowTokens: number;
  /** Model max output from the active context tier, or 0. */
  maxOutputTokens: number;
  /** Compaction trigger in tokens: prompt budget × effective compaction percent. */
  compactionThresholdTokens: number;
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
