/**
 * ErrorClassification — maps a provider failure's text and HTTP status to a recovery category.
 *
 * Pure rules, no state: `ErrorRecovery` decides what to do with a category; this module only names it.
 */

/** 错误分类。 */
export type ErrorCategory =
  | 'rate_limit'
  | 'overloaded'
  | 'prompt_too_long'
  | 'max_tokens'
  | 'auth_error'
  | 'network_error'
  | 'server_error'
  | 'empty_stream'
  | 'stream_protocol'
  | 'unknown';

/** One classification rule: the category it names and whether a failure's lowercased text and status belong to it. */
interface TextRule {
  category: ErrorCategory;
  matches: (raw: string, status: number | undefined) => boolean;
}

const includesAny = (raw: string, needles: readonly string[]): boolean =>
  needles.some((needle) => raw.includes(needle));

/** Ordered: the first matching rule wins (prompt length, then rate limit, overload, auth, network, server). */
const TEXT_RULES: readonly TextRule[] = [
  {
    category: 'prompt_too_long',
    matches: (raw) =>
      includesAny(raw, ['context_length_exceeded', 'context length', 'maximum context length']) ||
      (raw.includes('prompt') && raw.includes('long')) ||
      (raw.includes('input') && raw.includes('too') && raw.includes('long')),
  },
  {
    category: 'rate_limit',
    matches: (raw, status) => status === 429 || (raw.includes('rate') && raw.includes('limit')),
  },
  {
    category: 'overloaded',
    matches: (raw, status) =>
      status === 529 ||
      status === 503 ||
      includesAny(raw, ['overloaded', 'service unavailable', 'at capacity', 'high demand']),
  },
  {
    category: 'auth_error',
    matches: (raw, status) =>
      status === 401 ||
      status === 403 ||
      includesAny(raw, ['unauthorized', 'forbidden', 'invalid api key', 'authentication']),
  },
  {
    category: 'network_error',
    matches: (raw) =>
      includesAny(raw, [
        'econnrefused',
        'econnreset',
        'etimedout',
        'enotfound',
        'network',
        'timeout',
        'aborterror',
        'socket',
      ]),
  },
  {
    category: 'server_error',
    matches: (raw, status) => (status !== undefined && status >= 500) || raw.includes('internal server'),
  },
];

/** The category of a failure from its lowercased text and HTTP status; `unknown` when no rule matches. */
export function classifyProviderText(raw: string, status: number | undefined): ErrorCategory {
  return TEXT_RULES.find((rule) => rule.matches(raw, status))?.category ?? 'unknown';
}

/** The HTTP status an error carries: `status`, `statusCode`, `response.status`, or a status code in its message. */
export function extractErrorStatus(error: Error): number | undefined {
  // 兼容多种 SDK：err.status / err.statusCode / err.response.status
  const e = error as unknown as Record<string, unknown>;
  const direct = (e.status ?? e.statusCode) as number | undefined;
  if (typeof direct === 'number') return direct;
  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === 'number') return response.status;
  // 从错误消息中尝试解析：例如 "429 Too Many Requests"
  const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}
