import type {
  ConversationTurnControls,
  ReasoningControl,
  ReasoningSelection,
  ResolvedReasoningSelection,
} from './modelCapability';
import type {
  LlmProviderCapability,
  LlmProviderCatalogOwnership,
  LlmProviderCategory,
  LlmProviderLifecycleStatus,
  LlmProviderProtocol,
} from './settings';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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
  | { kind: 'body'; patch: JsonObject }
  | { kind: 'model-variant'; modelId: string };

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

interface GatedFastCapability {
  entitlement: EntitlementState;
  label?: string;
}

export type FastCapability =
  | ({ kind: 'request-param'; patch: JsonObject } & GatedFastCapability)
  | ({ kind: 'model-variant'; modelId: string } & GatedFastCapability)
  | ({ kind: 'client-tier'; tierId: string } & GatedFastCapability)
  | { kind: 'unsupported'; reason?: string }
  | { kind: 'unknown' };

export interface ModelRoute {
  protocol: LlmProviderProtocol;
  baseUrl?: string;
  headers?: Record<string, string>;
  source: 'model' | 'user' | 'preset';
}

export interface CapabilityConstraintSelector {
  fast?: boolean;
  maxContextMode?: boolean;
  tierIds?: string[];
  reasoningSelections?: ReasoningSelection[];
}

export type CapabilityConstraintAction =
  | {
      kind: 'clamp';
      control: 'fastModel' | 'maxContextMode' | 'reasoningLevel';
      value: boolean | ReasoningSelection;
    }
  | { kind: 'reject'; code: string };

export interface CapabilityConstraint {
  id: string;
  when: CapabilityConstraintSelector;
  action: CapabilityConstraintAction;
  reason: string;
}

export type CapabilityEvidenceSource =
  | 'seed'
  | 'discovery'
  | 'overlay'
  | 'entitlement'
  | 'observed'
  | 'user';

export interface CapabilityEvidence {
  field: string;
  source: CapabilityEvidenceSource;
  observedAt: string;
  expiresAt?: string;
  protocol?: LlmProviderProtocol;
  detail?: string;
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
  availability: EffectiveAvailability;
  unavailableReason?: string;
  contextTiers: ContextTier[];
  defaultBudgetTokens: number;
  fast: FastCapability;
  reasoning: ReasoningControl;
  toolCalling: CapabilityState;
  visionInput: CapabilityState;
  structuredOutput: CapabilityState;
  fixedTemperature?: number;
  quota?: { exhaustedUntil?: string; note?: string };
  constraints?: CapabilityConstraint[];
  provenance: CapabilityEvidence[];
}

export interface EffectiveCatalogSnapshot {
  providerId: string;
  accountId: string;
  protocol?: LlmProviderProtocol;
  models: EffectiveModel[];
  generatedAt: string;
  stale: boolean;
  refreshing: boolean;
  lastRefreshError?: string;
}

export interface RequestPlan {
  providerId: string;
  effectiveModelId: string;
  route: ModelRoute;
  headers: Record<string, string>;
  bodyPatch: JsonObject;
  contextBudgetTokens: number;
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
export type ProviderPresetAuthMode = 'api-key' | 'oauth' | 'device' | 'environment' | 'local';

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

export type DiscoveryStrategy =
  | {
      kind: 'json-catalog';
      method?: 'GET' | 'POST';
      url?: string;
      path?: string;
      headers?: Record<string, string>;
      collectionPath: string;
      mapping: DiscoveryFieldMapping;
      admission?: DiscoveryAdmission;
      routeRules?: DiscoveryRouteRule[];
      modelSet?: 'authoritative' | 'seed-validation';
    }
  | { kind: 'custom-parser'; parserId: string }
  | null;

export type SeedModelDefinition = Omit<
  EffectiveModel,
  'providerId' | 'vendorId' | 'provenance' | 'quota' | 'enabled'
> & { enabled?: boolean };

export interface ProviderPresetRoute {
  protocol: LlmProviderProtocol;
  baseUrl: string;
  headers?: Record<string, string>;
  default?: boolean;
}

export interface ProviderCapabilityOverlay {
  modelId: string;
  protocol?: LlmProviderProtocol;
  patch: JsonObject;
}

export interface ProviderPreset {
  schemaVersion: 1;
  id: string;
  vendorId: string;
  label: string;
  status: ProviderLifecycleStatus;
  sunsetAt?: string;
  availability: ProviderAvailability;
  category: LlmProviderCategory;
  catalogOwnership: LlmProviderCatalogOwnership;
  authModes: ProviderPresetAuthMode[];
  authModeAvailability?: Partial<Record<ProviderPresetAuthMode, ProviderAvailability>>;
  baseUrlEditable?: boolean;
  accountLoginConfigured?: boolean;
  capabilities?: LlmProviderCapability[];
  routes: ProviderPresetRoute[];
  userSelectableRoute: boolean;
  discovery: DiscoveryStrategy;
  seedModels: SeedModelDefinition[];
  overlays: ProviderCapabilityOverlay[];
  recommendedModels: string[];
  docsUrl: string;
}
