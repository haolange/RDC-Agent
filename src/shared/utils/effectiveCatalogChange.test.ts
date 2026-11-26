import { describe, expect, it } from 'vitest';
import { applyEffectiveCatalogChange, diffEffectiveCatalog } from './effectiveCatalogChange';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '../types/providerCapability';

const model = (modelId: string, label = modelId): EffectiveModel =>
  ({ modelId, label, catalogRevision: 'r1' }) as EffectiveModel;
const snapshot = (
  models: EffectiveModel[],
  version: number,
  catalogRevision = `r${version}`,
): EffectiveCatalogSnapshot => ({
  scopeGeneration: 'g',
  projectionVersion: version,
  providerId: 'p',
  accountId: 'a',
  catalogRevision,
  models: models.map((entry) => ({ ...entry, catalogRevision })),
  generatedAt: '2026-11-25T00:00:00Z',
  stale: false,
  refreshing: false,
});

describe('effective catalog changes', () => {
  it('carries only the changed fields of changed models and rebuilds the next snapshot from the base', () => {
    const base = snapshot([model('a'), { ...model('b'), unavailableReason: 'quota' } as EffectiveModel, model('c')], 1);
    const next = snapshot([model('a'), model('b', 'B renamed'), model('d')], 2);
    const change = diffEffectiveCatalog(base, next);
    expect(change.models.add.map((entry) => entry.modelId)).toEqual(['d']);
    expect(change.models.update).toEqual([
      { modelId: 'b', changes: [{ path: ['label'], value: 'B renamed' }, { path: ['unavailableReason'] }] },
    ]);
    expect(change.models.remove).toEqual(['c']);
    expect(change.models.order).toBeUndefined();
    expect(applyEffectiveCatalogChange(base, change)).toEqual(next);
  });

  it('sends a nested change as its path, and a shrunk list whole', () => {
    const provenance = [
      { field: 'enabled', source: 'catalog' },
      { field: 'label', source: 'catalog' },
    ];
    const base = snapshot([{ ...model('a'), provenance } as EffectiveModel], 1);
    const toggled = snapshot(
      [{ ...model('a'), provenance: [provenance[0], { field: 'label', source: 'user' }] } as EffectiveModel],
      2,
    );
    const change = diffEffectiveCatalog(base, toggled);
    expect(change.models.update).toEqual([
      { modelId: 'a', changes: [{ path: ['provenance', 1, 'source'], value: 'user' }] },
    ]);
    expect(applyEffectiveCatalogChange(base, change)).toEqual(toggled);
    expect(base.models[0]!.provenance[1]).toEqual({ field: 'label', source: 'catalog' });
    const shrunk = snapshot([{ ...model('a'), provenance: [provenance[0]] } as EffectiveModel], 3);
    const shrink = diffEffectiveCatalog(toggled, shrunk);
    expect(shrink.models.update).toEqual([
      { modelId: 'a', changes: [{ path: ['provenance'], value: [provenance[0]] }] },
    ]);
    expect(applyEffectiveCatalogChange(toggled, shrink)).toEqual(shrunk);
  });

  it('does not resend models whose only difference is the new catalog revision', () => {
    const base = snapshot([model('a'), model('b')], 1);
    const change = diffEffectiveCatalog(base, snapshot([model('a'), model('b')], 2));
    expect(change.models).toEqual({ add: [], update: [], remove: [] });
    expect(applyEffectiveCatalogChange(base, change)?.models.every((entry) => entry.catalogRevision === 'r2')).toBe(
      true,
    );
  });

  it('sends the order when it is not implied and the whole list without a base', () => {
    const base = snapshot([model('a'), model('b')], 1);
    const reordered = snapshot([model('b'), model('a')], 2);
    const change = diffEffectiveCatalog(base, reordered);
    expect(change.models.order).toEqual(['b', 'a']);
    expect(applyEffectiveCatalogChange(base, change)).toEqual(reordered);
    expect(applyEffectiveCatalogChange(null, diffEffectiveCatalog(null, reordered))).toEqual(reordered);
  });

  it('refuses a change against a snapshot the reader does not hold', () => {
    const change = diffEffectiveCatalog(snapshot([model('a')], 1), snapshot([model('a'), model('b')], 2));
    expect(applyEffectiveCatalogChange(snapshot([model('a')], 3), change)).toBeNull();
    expect(applyEffectiveCatalogChange(null, change)).toBeNull();
  });
});
