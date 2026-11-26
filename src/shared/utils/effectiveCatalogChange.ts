import type {
  EffectiveCatalogBase,
  EffectiveCatalogChange,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  EffectiveModelUpdate,
  EffectiveModelValueChange,
} from '../types/providerCapability';

type Json = unknown;

const isRecord = (value: Json): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const catalogBaseOf = (snapshot: EffectiveCatalogSnapshot): EffectiveCatalogBase => ({
  scopeGeneration: snapshot.scopeGeneration,
  projectionVersion: snapshot.projectionVersion,
  catalogRevision: snapshot.catalogRevision,
});

/**
 * The values that differ between two JSON values, as paths: objects key by key, equal-length arrays (and the shared
 * prefix of a longer one) index by index; anything else is replaced whole.
 */
function diffValue(before: Json, next: Json, path: Array<string | number>, changes: EffectiveModelValueChange[]): void {
  if (before === next) return;
  if (isRecord(before) && isRecord(next)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
      if (next[key] === undefined) {
        if (before[key] !== undefined) changes.push({ path: [...path, key] });
      } else {
        diffValue(before[key], next[key], [...path, key], changes);
      }
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(next) && next.length >= before.length) {
    next.forEach((item, index) => {
      if (index < before.length) diffValue(before[index], item, [...path, index], changes);
      else changes.push({ path: [...path, index], value: item });
    });
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(next)) changes.push({ path, value: next });
}

/** What changed in a model; the snapshot's catalog revision is not a model fact. */
function modelUpdate(before: EffectiveModel, next: EffectiveModel): EffectiveModelUpdate | null {
  const changes: EffectiveModelValueChange[] = [];
  diffValue({ ...before, catalogRevision: undefined }, { ...next, catalogRevision: undefined }, [], changes);
  return changes.length ? { modelId: next.modelId, changes } : null;
}

/** `root` with one value set or removed, copying only the containers on the path. */
function withValue(root: Json, path: ReadonlyArray<string | number>, change: EffectiveModelValueChange): Json {
  if (path.length === 0) return change.value;
  const [key, ...rest] = path;
  const container = (Array.isArray(root) ? [...root] : { ...(isRecord(root) ? root : {}) }) as Record<
    string | number,
    Json
  >;
  if (rest.length === 0 && !('value' in change)) {
    delete container[key!];
  } else {
    container[key!] = withValue(container[key!], rest, change);
  }
  return container;
}

/** `next` as a change against `base`; without a base the change carries every model. */
export function diffEffectiveCatalog(
  base: EffectiveCatalogSnapshot | null,
  next: EffectiveCatalogSnapshot,
): EffectiveCatalogChange {
  const { models, ...header } = next;
  if (!base) return { base: null, snapshot: header, models: { add: models, update: [], remove: [] } };
  const previous = new Map(base.models.map((model) => [model.modelId, model]));
  const nextIds = new Set(models.map((model) => model.modelId));
  const add: EffectiveModel[] = [];
  const update: EffectiveModelUpdate[] = [];
  for (const model of models) {
    const before = previous.get(model.modelId);
    if (!before) add.push(model);
    else {
      const changed = modelUpdate(before, model);
      if (changed) update.push(changed);
    }
  }
  const remove = base.models.map((model) => model.modelId).filter((modelId) => !nextIds.has(modelId));
  const implied = [
    ...base.models.map((model) => model.modelId).filter((modelId) => nextIds.has(modelId)),
    ...add.map((model) => model.modelId),
  ];
  const order = models.map((model) => model.modelId);
  const reordered = order.some((modelId, index) => implied[index] !== modelId);
  return {
    base: catalogBaseOf(base),
    snapshot: header,
    models: { add, update, remove, ...(reordered ? { order } : {}) },
  };
}

const sameBase = (snapshot: EffectiveCatalogSnapshot, base: EffectiveCatalogBase): boolean =>
  snapshot.scopeGeneration === base.scopeGeneration &&
  snapshot.projectionVersion === base.projectionVersion &&
  snapshot.catalogRevision === base.catalogRevision;

function applyModelUpdate(model: EffectiveModel, update: EffectiveModelUpdate): EffectiveModel {
  return update.changes.reduce<Json>((value, change) => withValue(value, change.path, change), model) as EffectiveModel;
}

/**
 * The snapshot a change produces from `current`; null when the change is against a snapshot `current` is not, so the
 * reader has to read the catalog again.
 */
export function applyEffectiveCatalogChange(
  current: EffectiveCatalogSnapshot | null,
  change: EffectiveCatalogChange,
): EffectiveCatalogSnapshot | null {
  const { catalogRevision } = change.snapshot;
  if (!change.base) {
    return { ...change.snapshot, models: change.models.add.map((model) => ({ ...model, catalogRevision })) };
  }
  if (!current || !sameBase(current, change.base)) return null;
  const removed = new Set(change.models.remove);
  const byId = new Map(current.models.map((model) => [model.modelId, model]));
  for (const update of change.models.update) {
    const model = byId.get(update.modelId);
    if (!model) return null;
    byId.set(update.modelId, applyModelUpdate(model, update));
  }
  for (const model of change.models.add) byId.set(model.modelId, model);
  const order = change.models.order ?? [
    ...current.models.map((model) => model.modelId).filter((modelId) => !removed.has(modelId)),
    ...change.models.add.map((model) => model.modelId),
  ];
  const models: EffectiveModel[] = [];
  for (const modelId of order) {
    const model = byId.get(modelId);
    if (!model) return null;
    models.push({ ...model, catalogRevision });
  }
  return { ...change.snapshot, models };
}
