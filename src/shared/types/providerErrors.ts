/**
 * Standardized provider error codes for the LLM HAL error model.
 */
export type ProviderErrorCode =
  | 'provider_unknown'
  | 'auth_unconfigured'
  | 'auth_expired'
  | 'auth_scope_denied'
  | 'model_source'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'network'
  | 'timeout'
  | 'context_overflow'
  | 'stream_protocol'
  | 'aborted'
  | 'unknown';

export interface ProviderErrorInfo {
  code: ProviderErrorCode;
  retryable: boolean;
  httpStatus?: number;
  message: string;
  details?: Record<string, unknown>;
}

/** Diagnostic entry attached to AssistantMessage on failure. */
export interface AssistantMessageDiagnostic {
  type: string;
  timestamp: number;
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
  details?: Record<string, unknown>;
}
