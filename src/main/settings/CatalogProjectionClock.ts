import { randomUUID } from 'node:crypto';
import type { EffectiveCatalogRequest } from './effectiveCatalogTypes';
import { revisionFor } from './effectiveCatalogMerge';

/** Configuration identity excludes renewed evidence and audit timestamps. */
function configurationFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(configurationFacts);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => ![
    'observedAt', 'refreshedAt', 'expiresAt', 'provenance', 'factSource', 'fieldFactSources', 'detail',
  ].includes(key)).map(([key, child]) => [key, configurationFacts(child)]));
}

export class CatalogProjectionClock {
  private scopes = new Map<string, { signature: string; generation: string; version: number; fingerprint?: string }>();

  bind(key: string, request: EffectiveCatalogRequest): { generation: string; changed: boolean } {
    const { discovery: _discovery, observed: _observed, entitlement: _entitlement, ...configuration } = request;
    const signature = revisionFor(configurationFacts(configuration));
    const current = this.scopes.get(key);
    if (current?.signature === signature) return { generation: current.generation, changed: false };
    const generation = randomUUID();
    this.scopes.set(key, { signature, generation, version: 0 });
    return { generation, changed: true };
  }

  generation(key: string): string | undefined { return this.scopes.get(key)?.generation; }
  invalidate(key: string): void { this.scopes.delete(key); }

  stamp(key: string, fingerprint: string): { scopeGeneration: string; projectionVersion: number } {
    const current = this.scopes.get(key);
    if (!current) throw new Error('Catalog projection has no configuration owner.');
    if (current.fingerprint !== fingerprint) { current.version += 1; current.fingerprint = fingerprint; }
    return { scopeGeneration: current.generation, projectionVersion: current.version };
  }
}
