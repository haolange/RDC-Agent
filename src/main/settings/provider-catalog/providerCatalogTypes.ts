import type { ProviderSurfaceManifest } from '@shared/provider-catalog/catalogManifestSchema';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveAvailability, RequestPlan, RequestPlanningErrorCode } from '@shared/types/providerCapability';
import type { JsonPrimitive } from '@shared/utils/jsonValue';

export interface ProviderAccountKey {
  providerId: string;
  accountId: string;
}

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

export interface ProviderAvailability {
  state: EffectiveAvailability;
  reason?: string;
}

export interface DiscoveryAdmission {
  allowPatterns?: string[];
  denyPatterns?: string[];
  allowedModalities?: string[];
  requireContextWindow?: boolean;
}

export type DiscoveryStrategy = ProviderSurfaceManifest['discovery']['strategy'];

export type ProviderProtocolOverride = ProviderSurfaceManifest['protocolOverrides'][number];

export type ProviderSurfaceDefinition = ProviderSurfaceManifest;

export interface DiscoveryCapabilityMapping {
  path: string;
  equals?: JsonPrimitive;
  includes?: JsonPrimitive;
}
