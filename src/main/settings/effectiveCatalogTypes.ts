import type {
  CapabilityEvidence,
  CapabilityEvidenceSource,
  CapabilityState,
  ControlDefinition,
  ContextTier,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  ExecutionBindingDefinition,
  ModelRoute,
  ProviderAvailability,
} from '@shared/types/providerCapability';
import type {
  LlmProviderCatalogOwnership,
  LlmProviderProtocol,
} from '@shared/types/settings';
import type { ReasoningControl } from '@shared/types/modelCapability';

export const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const EFFECTIVE_CATALOG_SCHEMA_VERSION = 8 as const;

export type PartialContextTier = Partial<ContextTier> & Pick<ContextTier, 'id'>;

export interface CatalogModelContribution {
  modelId: string;
  vendorId?: string;
  label?: string;
  aliases?: string[];
  enabled?: boolean;
  route?: Partial<ModelRoute>;
  routeOptions?: EffectiveModel['routeOptions'];
  preferredRouteOptionId?: string;
  selection?: EffectiveModel['selection'];
  presencePolicy?: EffectiveModel['presencePolicy'];
  availability?: EffectiveModel['availability'];
  unavailableReason?: string;
  contextTiers?: PartialContextTier[];
  defaultBudgetTokens?: number;
  cacheContract?: EffectiveModel['cacheContract'];
  controls?: {
    fast?: ControlDefinition;
    context1m?: ControlDefinition;
    reasoning?: Partial<ReasoningControl>;
  };
  executionBindings?: ExecutionBindingDefinition[];
  toolCalling?: CapabilityState;
  visionInput?: CapabilityState;
  structuredOutput?: CapabilityState;
  fixedTemperature?: number;
  quota?: EffectiveModel['quota'];
  factSource?: {
    sourceKind?: CapabilityEvidence['sourceKind'];
    observedAt?: string;
    refreshedAt?: string;
    sourceRevision?: string;
    sourceHash?: string;
    surface?: string;
    accountScope?: string;
    surfaceBuild?: string;
    plan?: string;
    detail?: string;
  };
  fieldFactSources?: Record<string, NonNullable<CatalogModelContribution['factSource']>>;
}

export interface CatalogLayerContribution {
  source: CapabilityEvidenceSource;
  sourceKind?: CapabilityEvidence['sourceKind'];
  observedAt: string;
  refreshedAt?: string;
  sourceRevision?: string;
  evidenceKey?: string;
  sourceHash?: string;
  surface?: string;
  accountScope?: string;
  surfaceBuild?: string;
  plan?: string;
  expiresAt?: string;
  protocol?: LlmProviderProtocol;
  detail?: string;
  models: CatalogModelContribution[];
}

export interface EffectiveCatalogRequest {
  providerId: string;
  accountId: string;
  protocol?: LlmProviderProtocol;
  catalogOwnership: LlmProviderCatalogOwnership;
  discoveryAuthority: 'authoritative-list' | 'candidate-validation' | 'additive' | 'entitlement-overlay';
  fallbackRoute: ModelRoute;
  catalog: CatalogLayerContribution;
  discovery?: CatalogLayerContribution;
  overlay?: CatalogLayerContribution;
  entitlement?: CatalogLayerContribution;
  observed?: CatalogLayerContribution | CatalogLayerContribution[];
  maintainedSurface?: CatalogLayerContribution;
  user?: CatalogLayerContribution;
  providerAvailability?: ProviderAvailability & { observedAt: string };
}

export interface PersistedCatalogState {
  schemaVersion: typeof EFFECTIVE_CATALOG_SCHEMA_VERSION;
  discoveries: Record<string, CatalogLayerContribution>;
  entitlements: Record<string, CatalogLayerContribution>;
  observed: Record<string, CatalogLayerContribution[]>;
}

export interface EffectiveCatalogServiceOptions {
  statePath?: string;
  now?: () => Date;
  discoveryTtlMs?: number;
}

export interface TransientQuotaEntry {
  quota: NonNullable<EffectiveModel['quota']>;
  observedAt: string;
  protocol?: LlmProviderProtocol;
}

export type LoadedCatalogLayer = Omit<CatalogLayerContribution, 'source' | 'observedAt' | 'expiresAt'>;

export interface DiscoveryLoadResult extends LoadedCatalogLayer {
  entitlement?: LoadedCatalogLayer;
}

export type DiscoveryLoader = () => Promise<DiscoveryLoadResult>;
export type DiscoveryLoaderResolver = (request: EffectiveCatalogRequest) => DiscoveryLoader | undefined;
export type DiscoveryLayerNormalizer = (
  request: EffectiveCatalogRequest,
  layer: CatalogLayerContribution,
) => CatalogLayerContribution;
export type EffectiveCatalogListener = (snapshot: EffectiveCatalogSnapshot) => void;
