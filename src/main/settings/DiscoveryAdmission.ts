import type { DiscoveryAdmission } from '@shared/types/providerCapability';

const DEFAULT_DENY_PATTERNS = [
  '*embedding*',
  '*moderation*',
  '*rerank*',
  '*whisper*',
  '*tts*',
  '*dall-e*',
  '*image*',
  '*audio*',
  '*realtime*',
  '*transcribe*',
  '*computer-use*',
];

export interface DiscoveryAdmissionDecision {
  accepted: boolean;
  reason?: 'missing-id' | 'allowlist' | 'deny-pattern' | 'modality' | 'unproven-alias';
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(value);
  } catch {
    return false;
  }
}

export function extractDiscoveredModelId(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return readString(value as Record<string, unknown>, 'id', 'name') ?? '';
}

export function evaluateDiscoveryAdmission(
  value: unknown,
  admission: DiscoveryAdmission = {},
): DiscoveryAdmissionDecision {
  const id = extractDiscoveredModelId(value);
  if (!id) return { accepted: false, reason: 'missing-id' };

  const allowPatterns = admission.allowPatterns ?? [];
  if (allowPatterns.length > 0 && !allowPatterns.some((pattern) => globMatches(id, pattern))) {
    return { accepted: false, reason: 'allowlist' };
  }
  const denyPatterns = [...DEFAULT_DENY_PATTERNS, ...(admission.denyPatterns ?? [])];
  if (denyPatterns.some((pattern) => globMatches(id, pattern))) {
    return { accepted: false, reason: 'deny-pattern' };
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const modality = readString(record, 'modality')?.toLowerCase();
    const allowedModalities = admission.allowedModalities?.map((entry) => entry.toLowerCase());
    if (modality && allowedModalities?.length && !allowedModalities.includes(modality)) {
      return { accepted: false, reason: 'modality' };
    }
    const recordKind = readString(record, 'type', 'kind', 'object')?.toLowerCase();
    const isAlias = record.is_alias === true || record.isAlias === true || recordKind === 'alias';
    const aliasTarget = readString(record, 'canonical_id', 'canonicalId', 'target', 'target_id', 'targetId');
    if (isAlias && !aliasTarget) {
      return { accepted: false, reason: 'unproven-alias' };
    }
  }

  return { accepted: true };
}

export function isAdmittedDiscoveredModel(value: unknown, admission?: DiscoveryAdmission): boolean {
  return evaluateDiscoveryAdmission(value, admission).accepted;
}
