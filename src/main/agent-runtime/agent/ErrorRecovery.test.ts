/**
 * ErrorRecovery 单元测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorRecovery } from './ErrorRecovery';
import type { Model } from '../core/types';

const PRIMARY: Model = {
  id: 'primary', name: 'Primary', provider: 'test', api: 'anthropic' as Model['api'],
  contextWindow: 128000, maxTokens: 4096, reasoning: false, vision: false,
};
const FALLBACK: Model = {
  id: 'fallback', name: 'Fallback', provider: 'test', api: 'anthropic' as Model['api'],
  contextWindow: 64000, maxTokens: 2048, reasoning: false, vision: false,
};

function makeErr(message: string, status?: number): Error {
  const err = new Error(message);
  if (status !== undefined) {
    (err as unknown as Record<string, unknown>).status = status;
  }
  return err;
}

describe('ErrorRecovery', () => {
  let recovery: ErrorRecovery;

  beforeEach(() => {
    recovery = new ErrorRecovery({
      primaryModel: PRIMARY,
      fallbackModel: FALLBACK,
    });
  });

  describe('classifyError', () => {
    it('应识别 context_length_exceeded 为 prompt_too_long', () => {
      expect(recovery.classifyError(makeErr('context_length_exceeded error'))).toBe('prompt_too_long');
    });

    it('应识别 context length 为 prompt_too_long', () => {
      expect(recovery.classifyError(makeErr('maximum context length exceeded'))).toBe('prompt_too_long');
    });

    it('应识别 429 为 rate_limit', () => {
      expect(recovery.classifyError(makeErr('Too Many Requests', 429))).toBe('rate_limit');
    });

    it('应识别 rate limit 文本为 rate_limit', () => {
      expect(recovery.classifyError(makeErr('rate limit exceeded'))).toBe('rate_limit');
    });

    it('应识别 529 为 overloaded', () => {
      expect(recovery.classifyError(makeErr('Service Unavailable', 529))).toBe('overloaded');
    });

    it('应识别 503 为 overloaded', () => {
      expect(recovery.classifyError(makeErr('Server Error', 503))).toBe('overloaded');
    });

    it('应识别 overloaded 文本为 overloaded', () => {
      expect(recovery.classifyError(makeErr('server overloaded'))).toBe('overloaded');
    });

    it('应识别 401 为 auth_error', () => {
      expect(recovery.classifyError(makeErr('Unauthorized', 401))).toBe('auth_error');
    });

    it('应识别 403 为 auth_error', () => {
      expect(recovery.classifyError(makeErr('Forbidden', 403))).toBe('auth_error');
    });

    it('应识别 invalid api key 为 auth_error', () => {
      expect(recovery.classifyError(makeErr('invalid api key'))).toBe('auth_error');
    });

    it('应识别 ECONNREFUSED 为 network_error', () => {
      expect(recovery.classifyError(makeErr('ECONNREFUSED'))).toBe('network_error');
    });

    it('应识别 ETIMEDOUT 为 network_error', () => {
      expect(recovery.classifyError(makeErr('ETIMEDOUT'))).toBe('network_error');
    });

    it('应识别 AbortError 为 network_error', () => {
      expect(recovery.classifyError(makeErr('AbortError: aborted'))).toBe('network_error');
    });

    it('应识别 500+ 为 server_error', () => {
      expect(recovery.classifyError(makeErr('Internal Error', 500))).toBe('server_error');
    });

    it('应识别 internal server 文本为 server_error', () => {
      expect(recovery.classifyError(makeErr('internal server error'))).toBe('server_error');
    });

    it('未识别的错误应返回 unknown', () => {
      expect(recovery.classifyError(makeErr('something weird happened'))).toBe('unknown');
    });

    it('ProviderStreamProtocolError 应分类为 stream_protocol', () => {
      const error = makeErr('Provider emitted delta after closing virtual:reasoning.');
      error.name = 'ProviderStreamProtocolError';
      (error as { code?: string }).code = 'PROVIDER_STREAM_BLOCK_CLOSED';
      expect(recovery.classifyError(error)).toBe('stream_protocol');
    });

    it('应从消息中提取 status code', () => {
      expect(recovery.classifyError(makeErr('HTTP 429 error'))).toBe('rate_limit');
    });
  });

  describe('isPromptTooLong', () => {
    it('prompt too long 错误应返回 true', () => {
      expect(recovery.isPromptTooLong(makeErr('context_length_exceeded'))).toBe(true);
    });

    it('其他错误应返回 false', () => {
      expect(recovery.isPromptTooLong(makeErr('network error'))).toBe(false);
    });
  });

  describe('decide', () => {
    it('stop_reason === length 且未压缩时应返回 reactive_compact', () => {
      const action = recovery.decide(null, 'length');
      expect(action.type).toBe('reactive_compact');
    });

    it('stop_reason === length 且已压缩时应返回 continue_prompt', () => {
      recovery.markReactiveCompactAttempted();
      const action = recovery.decide(null, 'length');
      expect(action.type).toBe('continue_prompt');
    });

    it('stop_reason === length 且恢复次数耗尽应 abort', () => {
      recovery.markReactiveCompactAttempted();
      recovery.noteRetryAttempt();
      const action = recovery.decide(null, 'length');
      expect(action.type).toBe('abort');
    });

    it('无 error 且无 stop_reason 应 abort', () => {
      const action = recovery.decide(null);
      expect(action.type).toBe('abort');
    });

    it('rate_limit 应返回 retry', () => {
      const action = recovery.decide(makeErr('rate limit', 429));
      expect(action.type).toBe('retry');
      if (action.type === 'retry') {
        expect(action.delayMs).toBeGreaterThan(0);
      }
    });

    it('rate_limit 重试耗尽应 abort', () => {
      recovery.noteRetryAttempt();
      recovery.noteRetryAttempt();
      recovery.noteRetryAttempt();
      const action = recovery.decide(makeErr('rate limit', 429));
      expect(action.type).toBe('abort');
    });

    it('overloaded 连续 3 次应切换模型', () => {
      // 前两次返回 retry
      recovery.decide(makeErr('overloaded', 529));
      recovery.decide(makeErr('overloaded', 529));
      // 第三次切换模型
      const action = recovery.decide(makeErr('overloaded', 529));
      expect(action.type).toBe('switch_model');
      if (action.type === 'switch_model') {
        expect(action.fallbackModel.id).toBe('fallback');
      }
    });

    it('overloaded 无备选模型时应 retry 然后 abort', () => {
      const r = new ErrorRecovery({ primaryModel: PRIMARY }); // 无 fallback
      r.noteRetryAttempt();
      r.noteRetryAttempt();
      r.noteRetryAttempt();
      const action = r.decide(makeErr('overloaded', 529));
      expect(action.type).toBe('abort');
    });

    it('prompt_too_long 应返回 reactive_compact', () => {
      const action = recovery.decide(makeErr('context_length_exceeded'));
      expect(action.type).toBe('reactive_compact');
    });

    it('prompt_too_long 已尝试 compact 后应 abort', () => {
      recovery.markReactiveCompactAttempted();
      const action = recovery.decide(makeErr('context_length_exceeded'));
      expect(action.type).toBe('abort');
    });

    it('auth_error 应立即 abort', () => {
      const action = recovery.decide(makeErr('invalid api key', 401));
      expect(action.type).toBe('abort');
    });

    it('network_error 应返回 retry', () => {
      const action = recovery.decide(makeErr('ECONNREFUSED'));
      expect(action.type).toBe('retry');
    });

    it('server_error 应返回 retry', () => {
      const action = recovery.decide(makeErr('internal server error', 500));
      expect(action.type).toBe('retry');
    });

    it('unknown error 应 abort', () => {
      const action = recovery.decide(makeErr('???'));
      expect(action.type).toBe('abort');
    });

    it('stream_protocol 应 abort 且不重试', () => {
      const error = makeErr('Provider emitted delta after closing virtual:reasoning.');
      error.name = 'ProviderStreamProtocolError';
      (error as { code?: string }).code = 'PROVIDER_STREAM_BLOCK_CLOSED';
      const action = recovery.decide(error);
      expect(action).toEqual({
        type: 'abort',
        reason: 'PROVIDER_STREAM_BLOCK_CLOSED: Provider emitted delta after closing virtual:reasoning.',
      });
      recovery.noteRetryAttempt();
      expect(recovery.decide(error).type).toBe('abort');
    });
  });

  describe('getRetryDelay', () => {
    it('应实现指数退避', () => {
      const d0 = recovery.getRetryDelay(0);
      const d1 = recovery.getRetryDelay(1);
      const d2 = recovery.getRetryDelay(2);
      // 基本递增：d1/d0 ≈ 2, d2/d0 ≈ 4（允许 500ms 抖动）
      expect(d0).toBeGreaterThanOrEqual(1000);
      expect(d0).toBeLessThanOrEqual(1500);
      expect(d1).toBeGreaterThanOrEqual(2000);
      expect(d1).toBeLessThanOrEqual(2500);
      expect(d2).toBeGreaterThanOrEqual(4000);
      expect(d2).toBeLessThanOrEqual(4500);
    });
  });

  describe('状态管理', () => {
    it('reset 应重置恢复状态但保留 currentModel', () => {
      recovery.noteRetryAttempt();
      recovery.markReactiveCompactAttempted();

      recovery.reset();

      const state = recovery.getState();
      expect(state.recoveryCount).toBe(0);
      expect(state.consecutiveOverloads).toBe(0);
      expect(state.hasAttemptedReactiveCompact).toBe(false);
      expect(state.currentModel.id).toBe('primary');
    });

    it('getCurrentModel 应返回当前模型', () => {
      expect(recovery.getCurrentModel().id).toBe('primary');
    });
  });
});
