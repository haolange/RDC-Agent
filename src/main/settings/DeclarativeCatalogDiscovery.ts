import { isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import type {
  DiscoveryStrategy,
  ModelRoute,
} from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';

type JsonCatalogDiscovery = Exclude<DiscoveryStrategy, null | { kind: 'custom-parser'; parserId: string }>;

export interface DeclarativeDiscoveredModel {
  id: string;
  label: string;
  aliases: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  protocol?: LlmProviderProtocol;
  modality?: string | string[];
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

function admittedByPreset(model: DeclarativeDiscoveredModel, discovery: JsonCatalogDiscovery): boolean {
  const admission = discovery.admission;
  if (!admission) return true;
  if (admission.allowPatterns?.length && !admission.allowPatterns.some((pattern) => globMatches(model.id, pattern))) return false;
  if (admission.denyPatterns?.some((pattern) => globMatches(model.id, pattern))) return false;
  if (admission.allowedModalities?.length) {
    const modalities = Array.isArray(model.modality) ? model.modality : model.modality ? [model.modality] : [];
    if (modalities.length > 0 && !modalities.some((value) => admission.allowedModalities?.includes(value))) return false;
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
    const protocol = protocolValue as LlmProviderProtocol | undefined;
    const modalityValue = readPath(value, discovery.mapping.modality);
    const model: DeclarativeDiscoveredModel = {
      id,
      label: toString(readPath(value, discovery.mapping.label)) ?? id,
      aliases: toStringArray(readPath(value, discovery.mapping.aliases)),
      contextWindow: toPositiveNumber(readPath(value, discovery.mapping.contextWindow)),
      maxOutputTokens: toPositiveNumber(readPath(value, discovery.mapping.maxOutputTokens)),
      protocol,
      modality: Array.isArray(modalityValue) ? toStringArray(modalityValue) : toString(modalityValue),
    };
    if (!isAdmittedDiscoveredModel(value) || !admittedByPreset(model, discovery) || models.has(id)) continue;
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
    protocol: model.protocol ?? fallback.protocol,
    source: model.protocol ? 'model' : 'preset',
  };
}
