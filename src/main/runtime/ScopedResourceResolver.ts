import { createHash } from 'crypto';
import type {
  ResolvedResource,
  ResourceProvenance,
  RestrictivePolicy,
  ScopedResourceCandidate,
  ScopedResourceCatalog,
} from '@shared/types/rdcRuntime';

const SCOPE_PRECEDENCE = { builtin: 0, user: 1, project: 2 } as const;
const APPROVAL_STRENGTH = { none: 0, destructive: 1, mutation: 2, all: 3 } as const;

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
};

export const hashScopedResource = (value: unknown): string =>
  createHash('sha256').update(stableSerialize(value)).digest('hex');

export class ScopedResourceResolver {
  resolve<T>(candidates: Array<ScopedResourceCandidate<T>>): ScopedResourceCatalog<T> {
    const diagnostics: ScopedResourceCatalog<T>['diagnostics'] = [];
    const grouped = new Map<string, Array<ScopedResourceCandidate<T>>>();

    for (const candidate of candidates) {
      const id = candidate.id.trim();
      if (!id) {
        diagnostics.push({
          code: 'resource.id.empty',
          severity: 'error',
          message: `Resource at ${candidate.sourcePath} has an empty id.`,
          sourcePath: candidate.sourcePath,
        });
        continue;
      }
      if (candidate.invalid) {
        diagnostics.push({
          code: 'resource.invalid',
          severity: 'error',
          message: candidate.invalidReason
            ?? `Resource ${id} at ${candidate.sourcePath} is invalid and will not override a lower-scope resource.`,
          sourcePath: candidate.sourcePath,
        });
        continue;
      }
      const groupKey = `${candidate.kind}:${id}`;
      const group = grouped.get(groupKey) ?? [];
      group.push({ ...candidate, id });
      grouped.set(groupKey, group);
    }

    const resources = Array.from(grouped.values()).map((group): ResolvedResource<T> => {
      const ordered = group.slice().sort((left, right) => {
        const scopeDelta = SCOPE_PRECEDENCE[left.scope] - SCOPE_PRECEDENCE[right.scope];
        return scopeDelta || left.sourcePath.localeCompare(right.sourcePath);
      });
      const winner = ordered[ordered.length - 1];
      const previous = ordered[ordered.length - 2];
      const provenance: ResourceProvenance = {
        scope: winner.scope,
        sourcePath: winner.sourcePath,
        sourceHash: hashScopedResource(winner.value),
        ...(previous ? {
          overriddenSource: {
            scope: previous.scope,
            sourcePath: previous.sourcePath,
            sourceHash: hashScopedResource(previous.value),
          },
        } : {}),
      };
      const enabled = winner.enabled !== false;
      return {
        id: winner.id,
        kind: winner.kind,
        value: winner.value,
        enabled,
        effectiveStatus: enabled ? (previous ? 'overridden' : winner.scope === 'builtin' ? 'effective' : 'inherited') : 'disabled',
        provenance,
      };
    });

    return {
      resources: resources.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)),
      diagnostics,
    };
  }

  tightenPolicy(base: RestrictivePolicy, project: RestrictivePolicy): RestrictivePolicy {
    const baseApproval = base.approval ?? 'none';
    const projectApproval = project.approval ?? baseApproval;
    if (APPROVAL_STRENGTH[projectApproval] < APPROVAL_STRENGTH[baseApproval]) {
      throw new Error(`Project policy cannot lower approval from ${baseApproval} to ${projectApproval}.`);
    }

    const limits: Record<string, number> = { ...(base.limits ?? {}) };
    for (const [key, value] of Object.entries(project.limits ?? {})) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Project policy limit ${key} must be a non-negative finite number.`);
      }
      if (limits[key] !== undefined && value > limits[key]) {
        throw new Error(`Project policy cannot raise ${key} from ${limits[key]} to ${value}.`);
      }
      limits[key] = Math.min(limits[key] ?? value, value);
    }

    return {
      deniedTools: Array.from(new Set([...(base.deniedTools ?? []), ...(project.deniedTools ?? [])])).sort(),
      approval: projectApproval,
      limits,
    };
  }
}

export const scopedResourceResolver = new ScopedResourceResolver();
