/**
 * Shared recursive secret/credential redaction for RequestEnvelope + RuntimeLog.
 * Fail-closed: credential-like keys and text patterns become [REDACTED].
 */

import { hashScopedResource } from './ScopedResourceResolver';

const SECRET_KEY =
  /(?:api[-_]?key|authorization|password|passwd|secret|private[-_]?key|cookie|(?:access|refresh|id|session|auth|bearer|oauth|github)[-_]?token|^token$)/i;
const PROTECTED_KEY =
  /^(?:encryptedContent|signature|thoughtSignature|redactedContent|opaqueState|reasoningContent|raw)$/i;
const SECRET_ASSIGNMENT =
  /((?:api[-_ ]?key|authorization|password|passwd|secret|private[-_ ]?key|(?:access|refresh|id|session|auth|bearer|oauth|github)[-_ ]?token)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Provider keys with a dash after the prefix (OpenAI, Anthropic, xAI, Slack). */
const DASH_PREFIXED_SECRET = /\b(?:sk-ant|sk|rk|xai|xox[abeoprs])-[A-Za-z0-9_-]{12,}/gi;
/** GitHub tokens: classic `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` and fine-grained `github_pat_`. */
const GITHUB_TOKEN = /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const AWS_ACCESS_KEY_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const GOOGLE_API_KEY = /\bAIza[A-Za-z0-9_-]{20,}\b/g;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export interface RedactionRecord {
  path: string;
  reason: string;
  hash: string;
}

export function redactCredentialLikeText(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(DASH_PREFIXED_SECRET, '[REDACTED]')
    .replace(GITHUB_TOKEN, '[REDACTED]')
    .replace(AWS_ACCESS_KEY_ID, '[REDACTED]')
    .replace(GOOGLE_API_KEY, '[REDACTED]')
    .replace(JWT_TOKEN, '[REDACTED]');
}

/** A bounded, redacted one-line preview of tool arguments for the visible work process. */
export function redactedArgumentsPreview(value: unknown): string {
  return ((JSON.stringify(redactSecretsDeep(value ?? {}).value) as string | undefined) ?? '{}').slice(0, 600);
}

export function redactSecretsDeep(
  value: unknown,
  currentPath = 'root',
  seen: WeakSet<object> = new WeakSet(),
  redactions: RedactionRecord[] = [],
): { value: unknown; redactions: RedactionRecord[] } {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return { value, redactions };
  }
  if (typeof value === 'string') {
    const sanitized = redactCredentialLikeText(value);
    if (sanitized !== value) {
      redactions.push({ path: currentPath, reason: 'credential-like text', hash: hashScopedResource(value) });
    }
    return { value: sanitized, redactions };
  }
  if (Array.isArray(value)) {
    return {
      value: value.map((entry, index) => redactSecretsDeep(entry, `${currentPath}[${index}]`, seen, redactions).value),
      redactions,
    };
  }
  if (typeof value !== 'object') {
    return { value: String(value), redactions };
  }
  if (seen.has(value)) {
    return { value: '[Circular]', redactions };
  }
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.type === 'thinking' && (record.kind === 'opaque' || record.visibility === 'hidden')) {
    redactions.push({ path: currentPath, reason: 'protected opaque reasoning', hash: hashScopedResource(record) });
    return {
      value: { type: 'thinking', kind: record.kind, visibility: record.visibility, redacted: true },
      redactions,
    };
  }
  if (record.type === 'image' || (typeof record.mimeType === 'string' && typeof record.data === 'string')) {
    redactions.push({ path: currentPath, reason: 'binary image payload', hash: hashScopedResource(record.data) });
    return {
      value: {
        type: record.type ?? 'image',
        mimeType: record.mimeType,
        byteLength: typeof record.data === 'string' ? record.data.length : undefined,
        redacted: true,
      },
      redactions,
    };
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const entryPath = `${currentPath}.${key}`;
    if (SECRET_KEY.test(key) || PROTECTED_KEY.test(key)) {
      redactions.push({
        path: entryPath,
        reason: SECRET_KEY.test(key) ? 'credential' : 'provider protected payload',
        hash: hashScopedResource(entry),
      });
      output[key] = '[REDACTED]';
      continue;
    }
    if (key === 'data' && typeof entry === 'string' && entry.length > 256) {
      redactions.push({ path: entryPath, reason: 'large opaque payload', hash: hashScopedResource(entry) });
      output[key] = `[REDACTED ${entry.length} chars]`;
      continue;
    }
    output[key] = redactSecretsDeep(entry, entryPath, seen, redactions).value;
  }
  return { value: output, redactions };
}
