import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import type { CatalogModelContribution } from './EffectiveCatalogService';
import type {
  CapabilityState,
  DiscoveryCapabilityMapping,
  DiscoveryStrategy,
  ModelRoute,
} from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { isLlmProviderProtocol } from '@shared/constants/llm';

type JsonCatalogDiscovery = Exclude<DiscoveryStrategy, null | { kind: 'custom-parser'; parserId: string }>;

export interface DeclarativeDiscoveredModel {
  id: string;
  label: string;
  aliases: string[];
  contextWindow?: number;
  contextWindowKind: 'prompt' | 'total';
  contextWindowAuthority: 'account-effective' | 'model-catalog';
  maxOutputTokens?: number;
  protocol?: LlmProviderProtocol;
  route?: Omit<ModelRoute, 'source'>;
  modality?: string | string[];
  toolCalling?: CapabilityState;
  visionInput?: CapabilityState;
  structuredOutput?: CapabilityState;
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (!path || path === '$') return value;
  return path.split('.').reduce<unknown>((current, segment) => (
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), value);
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toString).filter((entry): entry is string => Boolean(entry));
  const scalar = toString(value);
  return scalar ? [scalar] : [];
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'iu').test(value);
}

function capabilityState(value: unknown, mapping: DiscoveryCapabilityMapping | undefined): CapabilityState | undefined {
  if (!mapping || value === undefined || value === null) return undefined;
  if (mapping.includes !== undefined) {
    if (!Array.isArray(value)) return { state: 'unknown' };
    return { state: value.includes(mapping.includes) ? 'supported' : 'unsupported' };
  }
  if (mapping.equals !== undefined) {
    return { state: Object.is(value, mapping.equals) ? 'supported' : 'unsupported' };
  }
  if (typeof value === 'boolean') {
    return { state: value ? 'supported' : 'unsupported' };
  }
  return { state: 'unknown' };
}

function resolveRouteRule(
  modelId: string,
  discovery: JsonCatalogDiscovery,
): Omit<ModelRoute, 'source'> | undefined {
  const rule = discovery.routeRules?.find((candidate) => (
    candidate.allowPatterns.some((pattern) => globMatches(modelId, pattern))
  ));
  return rule
    ? {
        protocol: rule.protocol,
        baseUrl: rule.baseUrl,
        headers: rule.headers ? { ...rule.headers } : undefined,
      }
    : undefined;
}

function admittedByCatalog(model: DeclarativeDiscoveredModel, discovery: JsonCatalogDiscovery): boolean {
  const admission = discovery.admission;
  if (!admission) return true;
  if (admission.allowPatterns?.length && !admission.allowPatterns.some((pattern) => globMatches(model.id, pattern))) return false;
  if (admission.denyPatterns?.some((pattern) => globMatches(model.id, pattern))) return false;
  if (admission.allowedModalities?.length) {
    const modalities = Array.isArray(model.modality) ? model.modality : model.modality ? [model.modality] : [];
    if (modalities.length > 0 && !modalities.some((value) => admission.allowedModalities?.includes(value))) return false;
  }
  if (admission.requireContextWindow && model.contextWindow === undefined) return false;
  return true;
}

function rawAdmissionPredicates(value: unknown, discovery: JsonCatalogDiscovery): boolean {
  for (const predicate of discovery.admission?.predicates ?? []) {
    const actual = readPath(value, predicate.path);
    if (predicate.equals !== undefined && !Object.is(actual, predicate.equals)) return false;
    if (predicate.includes !== undefined) {
      if (!Array.isArray(actual) || !actual.some((entry) => Object.is(entry, predicate.includes))) return false;
    }
  }
  return true;
}

export function resolveDeclarativeDiscoveryUrl(discovery: JsonCatalogDiscovery, baseUrl: string): string {
  if (discovery.url) return discovery.url;
  const path = discovery.path ?? '/models';
  return `${baseUrl.trim().replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;
}

export function parseDeclarativeCatalog(
  discovery: JsonCatalogDiscovery,
  payload: unknown,
): DeclarativeDiscoveredModel[] {
  const collection = readPath(payload, discovery.collectionPath);
  if (!Array.isArray(collection)) return [];
  const models = new Map<string, DeclarativeDiscoveredModel>();
  for (const value of collection) {
    const id = toString(readPath(value, discovery.mapping.id));
    if (!id) continue;
    const protocolValue = toString(readPath(value, discovery.mapping.protocol));
    const protocol = isLlmProviderProtocol(protocolValue) ? protocolValue : undefined;
    const routeRule = resolveRouteRule(id, discovery);
    const modalityValue = readPath(value, discovery.mapping.modality);
    const model: DeclarativeDiscoveredModel = {
      id,
      label: toString(readPath(value, discovery.mapping.label)) ?? id,
      aliases: toStringArray(readPath(value, discovery.mapping.aliases)),
      contextWindow: toPositiveNumber(readPath(value, discovery.mapping.contextWindow)),
      contextWindowKind: discovery.mapping.contextWindowKind ?? 'total',
      contextWindowAuthority: discovery.mapping.contextWindowAuthority ?? 'account-effective',
      maxOutputTokens: toPositiveNumber(readPath(value, discovery.mapping.maxOutputTokens)),
      protocol: routeRule?.protocol ?? protocol,
      route: routeRule ?? (protocol ? { protocol } : undefined),
      modality: Array.isArray(modalityValue) ? toStringArray(modalityValue) : toString(modalityValue),
      toolCalling: capabilityState(
        readPath(value, discovery.mapping.toolCalling?.path),
        discovery.mapping.toolCalling,
      ),
      visionInput: capabilityState(
        readPath(value, discovery.mapping.visionInput?.path),
        discovery.mapping.visionInput,
      ),
      structuredOutput: capabilityState(
        readPath(value, discovery.mapping.structuredOutput?.path),
        discovery.mapping.structuredOutput,
      ),
    };
    const admittedIdentity = { ...value, id };
    if (!isAdmittedDiscoveredModel(admittedIdentity)
      || !rawAdmissionPredicates(value, discovery)
      || !admittedByCatalog(model, discovery)
      || models.has(id)) continue;
    models.set(id, model);
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function discoveredModelRoute(
  model: DeclarativeDiscoveredModel,
  fallback: Omit<ModelRoute, 'source'>,
): ModelRoute {
  return {
    ...fallback,
    ...(model.route ?? {}),
    protocol: model.route?.protocol ?? model.protocol ?? fallback.protocol,
    source: model.route || model.protocol ? 'model' : 'catalog',
  };
}

export function toDeclarativeCatalogContributions(
  models: DeclarativeDiscoveredModel[],
  fallbackRoute: Omit<ModelRoute, 'source'>,
): CatalogModelContribution[] {
  return models.map((model) => ({
    modelId: model.id,
    label: model.label,
    aliases: model.aliases,
    availability: 'available',
    route: discoveredModelRoute(model, fallbackRoute),
    ...(model.contextWindow !== undefined
      ? {
          contextTiers: [{
            id: 'default',
            label: 'Default',
            ...(model.contextWindowKind === 'prompt'
              ? { maxPromptTokens: model.contextWindow }
              : { maxTotalTokens: model.contextWindow }),
            maxOutputTokens: model.maxOutputTokens,
            activation: { kind: 'implicit' as const },
            entitlement: model.contextWindowAuthority === 'model-catalog' ? 'unknown' : 'granted',
          }],
          defaultBudgetTokens: Math.min(256_000, Math.max(
            1,
            model.contextWindowKind === 'prompt'
              ? model.contextWindow
              : model.contextWindow - (model.maxOutputTokens ?? 0),
          )),
          controls: {
            ...(model.contextWindowAuthority === 'model-catalog'
              ? {
                  context1m: {
                    state: 'unknown' as const,
                    defaultValue: false,
                    reason: 'The live catalog reports a model maximum; account entitlement is not verified.'
                  },
                }
              : model.contextWindow >= 1_000_000
              ? {
                  context1m: {
                    state: 'fixed' as const,
                    fixedValue: true,
                    tierId: 'default',
                  },
                }
              : {
                  context1m: {
                    state: 'unsupported' as const,
                    fixedValue: false,
                    reason: 'The live provider catalog reports a context window below 1M.',
                  },
                }),
          },
        }
      : {}),
    toolCalling: model.toolCalling,
    visionInput: model.visionInput,
    structuredOutput: model.structuredOutput,
  }));
}
