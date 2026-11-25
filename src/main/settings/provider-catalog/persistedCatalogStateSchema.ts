import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { isObject } from './effectiveCatalogMerge';
import {
  EFFECTIVE_CATALOG_SCHEMA_VERSION,
  type CatalogLayerContribution,
  type CatalogModelContribution,
  type PersistedCatalogState,
} from './effectiveCatalogTypes';
import type { CapabilityEvidenceSource } from '@shared/types/providerCapability';

const EVIDENCE_SOURCES: ReadonlySet<string> = new Set<CapabilityEvidenceSource>([
  'catalog', 'discovery', 'overlay', 'entitlement', 'observed', 'maintained-surface', 'user',
]);

const optionalText = (value: unknown): boolean => value === undefined || typeof value === 'string';

/**
 * A model row as the merge reads it: a model id, string labels, and object-shaped nested facts. The nested facts
 * were produced by this build's discovery normalizers and are re-admitted by `enforceDiscoveryAdmission`.
 */
function isModelContribution(value: unknown): value is CatalogModelContribution {
  if (!isObject(value) || typeof value.modelId !== 'string' || !value.modelId) return false;
  if (!optionalText(value.vendorId) || !optionalText(value.label)) return false;
  if (value.aliases !== undefined && !(Array.isArray(value.aliases) && value.aliases.every((alias) => typeof alias === 'string'))) return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  for (const field of ['route', 'controls', 'cost', 'quota', 'selection', 'factSource', 'fieldFactSources'] as const) {
    if (value[field] !== undefined && !isObject(value[field])) return false;
  }
  for (const field of ['routeOptions', 'contextTiers', 'executionBindings'] as const) {
    if (value[field] !== undefined && !Array.isArray(value[field])) return false;
  }
  return true;
}

const CatalogLayerSchema = z.custom<CatalogLayerContribution>((value) => (
  isObject(value)
  && typeof value.source === 'string' && EVIDENCE_SOURCES.has(value.source)
  && typeof value.observedAt === 'string'
  && ['catalogProjectionRevision', 'refreshedAt', 'sourceRevision', 'evidenceKey', 'sourceHash', 'surface',
    'accountScope', 'surfaceBuild', 'plan', 'expiresAt', 'protocol', 'detail'].every((field) => optionalText(value[field]))
  && Array.isArray(value.models)
  && value.models.every(isModelContribution)
), 'catalog layer needs a known source, an observedAt time and model rows with ids');

const PersistedCatalogStateSchema = z.object({
  schemaVersion: z.literal(EFFECTIVE_CATALOG_SCHEMA_VERSION),
  discoveries: z.record(z.string(), CatalogLayerSchema),
  entitlements: z.record(z.string(), CatalogLayerSchema),
  observed: z.record(z.string(), z.array(CatalogLayerSchema)),
}).strict();

/**
 * The parser for the catalog state file under `readValidatedSync`. Another schemaVersion (or none) is
 * `STORAGE_SCHEMA_UNSUPPORTED`; anything else that does not match throws, which the read reports as `STORAGE_CORRUPT`.
 */
export function parsePersistedCatalogState(value: unknown): PersistedCatalogState {
  if (!isObject(value)) throw new TypeError('catalog state must be a JSON object');
  if (value.schemaVersion !== EFFECTIVE_CATALOG_SCHEMA_VERSION) {
    throw new AppError(
      'STORAGE_SCHEMA_UNSUPPORTED',
      `catalog state schemaVersion ${String(value.schemaVersion)}; this build reads only ${EFFECTIVE_CATALOG_SCHEMA_VERSION}`,
    );
  }
  const parsed = PersistedCatalogStateSchema.safeParse(value);
  if (!parsed.success) throw new TypeError(z.prettifyError(parsed.error));
  return parsed.data;
}
