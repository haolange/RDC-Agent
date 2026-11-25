import { diffEffectiveCatalog } from '@shared/utils/effectiveCatalogChange';
import type { EffectiveCatalogChange, EffectiveCatalogSnapshot } from '@shared/types/providerCapability';

const scopeKey = (snapshot: EffectiveCatalogSnapshot): string => (
  `${snapshot.providerId}\u0000${snapshot.accountId}\u0000${snapshot.protocol ?? 'default'}`
);

/**
 * Sends catalog snapshots to the renderer as changes: each against the snapshot last handed out for its scope,
 * whether by an earlier change or by a read. The renderer applies a change only to that snapshot.
 */
export class CatalogChangePublisher {
  private readonly handedOut = new Map<string, EffectiveCatalogSnapshot>();

  constructor(private readonly send: (change: EffectiveCatalogChange) => void) {}

  /** A snapshot a read returned whole; the next change for its scope is computed against it. */
  delivered(snapshot: EffectiveCatalogSnapshot): void {
    this.handedOut.set(scopeKey(snapshot), snapshot);
  }

  publish(snapshot: EffectiveCatalogSnapshot): void {
    const key = scopeKey(snapshot);
    const change = diffEffectiveCatalog(this.handedOut.get(key) ?? null, snapshot);
    this.handedOut.set(key, snapshot);
    this.send(change);
  }
}
