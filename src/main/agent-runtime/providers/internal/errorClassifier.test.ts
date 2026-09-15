import { describe, it, expect } from 'vitest';
import { classifyProviderError, isRetryableAssistantError } from './errorClassifier';
import type { AssistantMessage } from '@main/agent-runtime/core/types';

describe('classifyProviderError', () => {
  describe('HTTP status classification', () => {
    it('classifies 429 as retryable rate_limit', () => {
      const result = classifyProviderError(new Error('Too Many Requests'), 429);
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
      expect(result.httpStatus).toBe(429);
    });

    it('classifies 500 as retryable network', () => {
      const result = classifyProviderError(new Error('Internal Server Error'), 500);
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies 502 as retryable network', () => {
      const result = classifyProviderError(new Error('Bad Gateway'), 502);
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies 503 as retryable network', () => {
      const result = classifyProviderError(new Error('Service Unavailable'), 503);
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies 504 as retryable network', () => {
      const result = classifyProviderError(new Error('Gateway Timeout'), 504);
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies 401 as non-retryable auth_expired', () => {
      const result = classifyProviderError(new Error('Unauthorized'), 401);
      expect(result.code).toBe('auth_expired');
      expect(result.retryable).toBe(false);
    });

    it('classifies 403 as non-retryable auth_expired', () => {
      const result = classifyProviderError(new Error('Forbidden'), 403);
      expect(result.code).toBe('auth_expired');
      expect(result.retryable).toBe(false);
    });

    it('classifies 400 with context message as context_overflow', () => {
      const result = classifyProviderError(
        new Error('This model maximum context length is 128000 tokens, too long input'),
        400,
      );
      expect(result.code).toBe('context_overflow');
      expect(result.retryable).toBe(false);
    });

    it('classifies 400 with token limit as context_overflow', () => {
      const result = classifyProviderError(new Error('token limit exceeded'), 400);
      expect(result.code).toBe('context_overflow');
      expect(result.retryable).toBe(false);
    });

    it('classifies 404 as model_source', () => {
      const result = classifyProviderError(new Error('Model not found'), 404);
      expect(result.code).toBe('model_source');
      expect(result.retryable).toBe(false);
    });
  });

  describe('message pattern classification — retryable', () => {
    it('classifies "overloaded" as retryable rate_limit', () => {
      const result = classifyProviderError(new Error('This model is currently overloaded'));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
    });

    it('classifies "rate limit" as retryable rate_limit', () => {
      const result = classifyProviderError(new Error('Rate limit exceeded for your plan'));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
    });

    it('classifies "rate_limit" as retryable rate_limit', () => {
      const result = classifyProviderError(new Error('error code: rate_limit'));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
    });

    it('classifies "too many requests" as retryable rate_limit', () => {
      const result = classifyProviderError(new Error('Too many requests, please slow down'));
      expect(result.code).toBe('rate_limit');
      expect(result.retryable).toBe(true);
    });

    it('classifies "network error" as retryable network', () => {
      const result = classifyProviderError(new Error('A network error occurred'));
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies "connection refused" as retryable network', () => {
      const result = classifyProviderError(new Error('Connection refused by remote host'));
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies "ECONNREFUSED" as retryable network', () => {
      const result = classifyProviderError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies "ECONNRESET" as retryable network', () => {
      const result = classifyProviderError(new Error('read ECONNRESET'));
      expect(result.code).toBe('network');
      expect(result.retryable).toBe(true);
    });

    it('classifies "timeout" as retryable timeout', () => {
      const result = classifyProviderError(new Error('Request timeout after 30000ms'));
      expect(result.code).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies "timed out" as retryable timeout', () => {
      const result = classifyProviderError(new Error('The operation timed out'));
      expect(result.code).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies "ETIMEDOUT" as retryable timeout', () => {
      const result = classifyProviderError(new Error('connect ETIMEDOUT 10.0.0.1:443'));
      expect(result.code).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies "stream ended without message_stop" as retryable stream_protocol', () => {
      const result = classifyProviderError(new Error('stream ended without message_stop'));
      expect(result.code).toBe('stream_protocol');
      expect(result.retryable).toBe(true);
    });

    it('classifies "you can retry your request" as retryable stream_protocol', () => {
      const result = classifyProviderError(new Error('Error occurred, you can retry your request'));
      expect(result.code).toBe('stream_protocol');
      expect(result.retryable).toBe(true);
    });
  });

  describe('message pattern classification — non-retryable', () => {
    it('classifies "insufficient_quota" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('You have insufficient_quota remaining'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies "out of budget" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('Account is out of budget'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies "quota exceeded" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('Monthly quota exceeded'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies "billing" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('Please check your billing information'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies "usage limit reached" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('Usage limit reached for this period'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies "available balance" as quota_exceeded', () => {
      const result = classifyProviderError(new Error('No available balance in account'));
      expect(result.code).toBe('quota_exceeded');
      expect(result.retryable).toBe(false);
    });

    it('classifies Grok invalid-argument tool schema as request_rejected', () => {
      const result = classifyProviderError(
        new Error('shell: tool parameter root must be an object type (root schema is an anyOf/oneOf union)'),
        400,
      );
      expect(result.code).toBe('request_rejected');
      expect(result.retryable).toBe(false);
    });

    it('classifies model not found by message as model_source', () => {
      const result = classifyProviderError(new Error('model_not_found: grok-4.6'));
      expect(result.code).toBe('model_source');
      expect(result.retryable).toBe(false);
    });

    it('classifies "provider not found" as provider_unknown', () => {
      const result = classifyProviderError(new Error('provider not found: my-custom-llm'));
      expect(result.code).toBe('provider_unknown');
      expect(result.retryable).toBe(false);
    });
  });

  describe('auth_scope_denied', () => {
    it('classifies scope error with HTTP 403 as auth_scope_denied', () => {
      const result = classifyProviderError(
        new Error('OAuth scope "chat:write" not granted'),
        403,
      );
      expect(result.code).toBe('auth_scope_denied');
      expect(result.retryable).toBe(false);
    });

    it('classifies permission error with HTTP 401 as auth_scope_denied', () => {
      const result = classifyProviderError(
        new Error('Insufficient permission for this operation'),
        401,
      );
      expect(result.code).toBe('auth_scope_denied');
      expect(result.retryable).toBe(false);
    });

    it('classifies "access denied" message as auth_scope_denied', () => {
      const result = classifyProviderError(new Error('Access denied for this resource'));
      expect(result.code).toBe('auth_scope_denied');
      expect(result.retryable).toBe(false);
    });

    it('classifies scope message without HTTP status as auth_scope_denied', () => {
      const result = classifyProviderError(new Error('Missing required scope: models.read'));
      expect(result.code).toBe('auth_scope_denied');
      expect(result.retryable).toBe(false);
    });
  });

  describe('aborted signal handling', () => {
    it('classifies AbortError by name', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      const result = classifyProviderError(err);
      expect(result.code).toBe('aborted');
      expect(result.retryable).toBe(false);
    });

    it('classifies abort message', () => {
      const result = classifyProviderError(new Error('Request abort by user'));
      expect(result.code).toBe('aborted');
      expect(result.retryable).toBe(false);
    });

    it('classifies error with aborted signal property', () => {
      const controller = new AbortController();
      controller.abort();
      const err = Object.assign(new Error('cancelled'), { signal: controller.signal });
      const result = classifyProviderError(err);
      expect(result.code).toBe('aborted');
      expect(result.retryable).toBe(false);
    });
  });

  describe('stream protocol violations', () => {
    it('classifies "stream protocol" error', () => {
      const result = classifyProviderError(new Error('stream protocol violation detected'));
      expect(result.code).toBe('stream_protocol');
      expect(result.retryable).toBe(false);
    });

    it('classifies "invalid sse" error', () => {
      const result = classifyProviderError(new Error('invalid sse frame received'));
      expect(result.code).toBe('stream_protocol');
      expect(result.retryable).toBe(false);
    });

    it('classifies "malformed chunk" error', () => {
      const result = classifyProviderError(new Error('malformed chunk in response body'));
      expect(result.code).toBe('stream_protocol');
      expect(result.retryable).toBe(false);
    });
  });

  describe('unknown / fallback', () => {
    it('classifies unrecognized error as unknown', () => {
      const result = classifyProviderError(new Error('Something completely unexpected'));
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
    });

    it('handles non-Error values', () => {
      const result = classifyProviderError('random string failure');
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
      expect(result.message).toBe('random string failure');
    });

    it('handles null/undefined', () => {
      const result = classifyProviderError(null);
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(false);
    });
  });
});

describe('isRetryableAssistantError', () => {
  function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return {
      role: 'assistant',
      content: [],
      model: 'test-model',
      provider: 'test-provider',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: 'error',
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it('returns true for retryable diagnostic (rate limit)', () => {
    const msg = makeAssistantMessage({
      diagnostics: [
        {
          type: 'provider_error',
          timestamp: Date.now(),
          error: { message: 'Rate limit exceeded' },
        },
      ],
    });
    expect(isRetryableAssistantError(msg)).toBe(true);
  });

  it('returns false for non-retryable diagnostic (auth)', () => {
    const msg = makeAssistantMessage({
      diagnostics: [
        {
          type: 'provider_error',
          timestamp: Date.now(),
          error: { message: 'Unauthorized', code: 401 },
        },
      ],
    });
    expect(isRetryableAssistantError(msg)).toBe(false);
  });

  it('returns false when stopReason is not error', () => {
    const msg = makeAssistantMessage({ stopReason: 'stop' });
    expect(isRetryableAssistantError(msg)).toBe(false);
  });

  it('returns false when no diagnostics present', () => {
    const msg = makeAssistantMessage({ stopReason: 'error' });
    expect(isRetryableAssistantError(msg)).toBe(false);
  });

  it('returns true for timeout diagnostic', () => {
    const msg = makeAssistantMessage({
      diagnostics: [
        {
          type: 'provider_error',
          timestamp: Date.now(),
          error: { message: 'Request timed out after 60s' },
        },
      ],
    });
    expect(isRetryableAssistantError(msg)).toBe(true);
  });
});
