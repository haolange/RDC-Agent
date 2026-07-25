import type { ProviderErrorInfo } from '@shared/types/providerErrors';
import type { AssistantMessage } from '@main/agent-runtime/core/types';

/**
 * Classify an unknown provider error into a standardized error model.
 *
 * Pure function — no side effects, no state.
 */
export function classifyProviderError(error: unknown, httpStatus?: number): ProviderErrorInfo {
  const message = extractMessage(error);
  const name = extractName(error);
  const lowerMessage = message.toLowerCase();

  // --- Abort handling ---
  if (isAbortError(error, name, lowerMessage)) {
    return {
      code: 'aborted',
      retryable: false,
      httpStatus,
      message: message || 'Request aborted',
    };
  }

  // --- Provider not found ---
  if (lowerMessage.includes('provider not found') || lowerMessage.includes('provider_unknown')) {
    return {
      code: 'provider_unknown',
      retryable: false,
      httpStatus,
      message,
    };
  }

  // --- HTTP status-based classification ---
  if (httpStatus !== undefined) {
    const statusResult = classifyByHttpStatus(httpStatus, lowerMessage, message);
    if (statusResult) {
      return statusResult;
    }
  }

  // --- Message pattern-based classification ---
  const patternResult = classifyByMessagePattern(lowerMessage, message, httpStatus);
  if (patternResult) {
    return patternResult;
  }

  // --- Stream protocol violations ---
  if (isStreamProtocolError(lowerMessage)) {
    return {
      code: 'stream_protocol',
      retryable: false,
      httpStatus,
      message,
    };
  }

  // --- Fallback ---
  return {
    code: 'unknown',
    retryable: false,
    httpStatus,
    message: message || 'Unknown provider error',
  };
}

/**
 * Check whether an AssistantMessage that ended in error is retryable.
 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  if (message.stopReason !== 'error' && message.stopReason !== 'aborted') {
    return false;
  }

  const diagnostics = message.diagnostics;
  if (!diagnostics || diagnostics.length === 0) {
    return false;
  }

  for (const diag of diagnostics) {
    if (diag.error) {
      const info = classifyProviderError(diag.error, undefined);
      if (info.retryable) {
        return true;
      }
    }
  }

  return false;
}

// =====================================================================
// Internal helpers
// =====================================================================

function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error ?? '');
}

function extractName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as Record<string, unknown>).name);
  }
  return '';
}

function isAbortError(error: unknown, name: string, lowerMessage: string): boolean {
  if (name === 'AbortError') return true;
  if (lowerMessage.includes('abort')) return true;
  if (error && typeof error === 'object' && 'signal' in error) {
    const signal = (error as Record<string, unknown>).signal;
    if (signal instanceof AbortSignal && signal.aborted) return true;
  }
  return false;
}

function classifyByHttpStatus(
  status: number,
  lowerMessage: string,
  message: string,
): ProviderErrorInfo | null {
  // Retryable server/rate-limit statuses
  if (status === 429) {
    return { code: 'rate_limit', retryable: true, httpStatus: status, message };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: 'network', retryable: true, httpStatus: status, message };
  }

  // Auth errors
  if (status === 401 || status === 403) {
    if (isScopeRelated(lowerMessage)) {
      return { code: 'auth_scope_denied', retryable: false, httpStatus: status, message };
    }
    if (lowerMessage.includes('unconfigured') || lowerMessage.includes('not configured')) {
      return { code: 'auth_unconfigured', retryable: false, httpStatus: status, message };
    }
    return { code: 'auth_expired', retryable: false, httpStatus: status, message };
  }

  // Context overflow (HTTP 400 with context-related message)
  if (status === 400 && isContextOverflow(lowerMessage)) {
    return { code: 'context_overflow', retryable: false, httpStatus: status, message };
  }

  // 404 — model not found
  if (status === 404) {
    return { code: 'model_source', retryable: false, httpStatus: status, message };
  }

  return null;
}

function classifyByMessagePattern(
  lowerMessage: string,
  message: string,
  httpStatus?: number,
): ProviderErrorInfo | null {
  // Rate limit patterns
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('rate_limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('overloaded')
  ) {
    return { code: 'rate_limit', retryable: true, httpStatus, message };
  }

  // Network patterns
  if (
    lowerMessage.includes('network error') ||
    lowerMessage.includes('connection refused') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('econnreset')
  ) {
    return { code: 'network', retryable: true, httpStatus, message };
  }

  // Timeout patterns
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('etimedout')
  ) {
    return { code: 'timeout', retryable: true, httpStatus, message };
  }

  // Retryable stream patterns
  if (
    lowerMessage.includes('stream ended without message_stop') ||
    lowerMessage.includes('you can retry your request')
  ) {
    return { code: 'stream_protocol', retryable: true, httpStatus, message };
  }

  // Quota patterns
  if (
    lowerMessage.includes('insufficient_quota') ||
    lowerMessage.includes('out of budget') ||
    lowerMessage.includes('quota exceeded') ||
    lowerMessage.includes('billing') ||
    lowerMessage.includes('usage limit reached') ||
    lowerMessage.includes('available balance')
  ) {
    return { code: 'quota_exceeded', retryable: false, httpStatus, message };
  }

  // Auth scope patterns
  if (isScopeRelated(lowerMessage)) {
    return { code: 'auth_scope_denied', retryable: false, httpStatus, message };
  }

  // Context overflow patterns (without HTTP status)
  if (isContextOverflow(lowerMessage)) {
    return { code: 'context_overflow', retryable: false, httpStatus, message };
  }

  return null;
}

function isScopeRelated(lowerMessage: string): boolean {
  return (
    lowerMessage.includes('scope') ||
    lowerMessage.includes('permission') ||
    lowerMessage.includes('access denied')
  );
}

function isContextOverflow(lowerMessage: string): boolean {
  return (
    (lowerMessage.includes('context') && lowerMessage.includes('too long')) ||
    lowerMessage.includes('token limit') ||
    lowerMessage.includes('context length') ||
    lowerMessage.includes('maximum context')
  );
}

function isStreamProtocolError(lowerMessage: string): boolean {
  return (
    lowerMessage.includes('stream protocol') ||
    lowerMessage.includes('invalid sse') ||
    lowerMessage.includes('malformed chunk') ||
    lowerMessage.includes('unexpected stream format')
  );
}
