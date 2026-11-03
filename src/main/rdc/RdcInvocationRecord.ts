import { createHash } from 'node:crypto';
import { canonicalJson } from './RdcOperationCatalog';

export function containsSensitiveRequestKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveRequestKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => /(?:password|secret|token|authorization|credential|api[_-]?key)/i.test(key) || containsSensitiveRequestKey(child));
}

/** Describes exactly the authorized CLI args, never its transport environment or credentials. */
export function rdcInvocationRecord(operation: string, args: Record<string, unknown>) {
  const argsFingerprint = createHash('sha256').update(canonicalJson(args)).digest('hex');
  return { kind: 'main-validated-cli-arguments', operation, argsFingerprint,
    ...(containsSensitiveRequestKey(args) ? { argsOmittedReason: 'sensitive-argument-keys' } : { args }) };
}
