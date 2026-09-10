import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({ agents: { definitions: [] } }),
  },
}));
import { AgentRecoveryAbortError } from '../agent-runtime/agent/ErrorRecovery';
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';
import { ProviderEmptyStreamError, ProviderHttpError, ProviderWireFailureError } from '../agent-runtime/providers/internal/http';
import { createTurnFailedDiagnostic } from './ConversationRoutePreflight';
import { MissionCompletionError } from '../investigation/missionCompletionContract';

const ROUTE = {
  agentId: 'plan' as const,
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
};

describe('conversation turn failure classification', () => {
  it('classifies no-progress termination independently from provider failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new AgentLoopTerminationError(
        'AGENT_NO_PROGRESS',
        'same tool round repeated three times',
        { turn: 3 },
      ),
    );
    expect(diagnostic.code).toBe('CONVERSATION_AGENT_LOOP_STALLED');
    expect(diagnostic.userMessage).toContain('连续三轮');
    expect(diagnostic.userMessage).not.toContain(String.fromCodePoint(0xfffd));
  });

  it('classifies pending continuation at max turns independently from provider failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new AgentLoopTerminationError(
        'AGENT_MAX_TURNS_EXCEEDED',
        'continuation remained pending',
        { turn: 25, maxTurns: 25 },
      ),
    );
    expect(diagnostic.code).toBe('CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED');
    expect(diagnostic.userMessage).toContain('25 轮上限');
  });

  it('classifies 401 as an auth failure with structured technicalMessage', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new ProviderHttpError('anthropic', 401, 'invalid api key', 'unauthorized'),
    );
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('认证或权限失败');
    expect(diagnostic.technicalMessage).toBe('provider HTTP 401 · attempts 1/1 · unauthorized');
  });

  it('classifies 429 quota as a rate-limit failure', () => {
    const diagnostic = createTurnFailedDiagnostic(ROUTE, new Error('429 quota exceeded'));
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('额度不足或触发了限流');
    expect(diagnostic.technicalMessage).toBe('provider HTTP 429 · attempts 1/1 · 429 quota exceeded');
  });

  it('classifies real HTTP 5xx as a server failure that includes status', () => {
    const original = new ProviderHttpError('anthropic', 503, 'upstream exploded', '{"error":"boom"}');
    const abort = new AgentRecoveryAbortError('[Recovery abort] server_error retries exhausted', {
      cause: original,
      category: 'server_error',
      attempts: 4,
      maxAttempts: 4,
      lastStatus: 503,
      bodySnippet: '{"error":"boom"}',
    });
    const diagnostic = createTurnFailedDiagnostic(ROUTE, abort);
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('服务端错误（HTTP 503）');
    expect(diagnostic.technicalMessage).toBe('provider HTTP 503 · attempts 4/4 · {"error":"boom"}');
  });

  it('classifies empty stream separately from HTTP 5xx', () => {
    const original = new ProviderEmptyStreamError('openai-responses');
    const abort = new AgentRecoveryAbortError('[Recovery abort] empty_stream retries exhausted', {
      cause: original,
      category: 'empty_stream',
      attempts: 2,
      maxAttempts: 2,
    });
    const diagnostic = createTurnFailedDiagnostic(ROUTE, abort);
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('服务商没有返回助手正文或结构化工具调用');
    expect(diagnostic.technicalMessage).toBe(
      'provider HTTP n/a · attempts 2/2 · Provider stream ended without assistant output or structured tool call.',
    );
  });

  it('classifies network reset as a network failure', () => {
    const diagnostic = createTurnFailedDiagnostic(ROUTE, new Error('read ECONNRESET'));
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('网络连接失败');
    expect(diagnostic.technicalMessage).toBe('provider HTTP n/a · attempts 1/1 · read ECONNRESET');
  });

  it('classifies stream protocol violations independently from account failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new AgentRecoveryAbortError(
        '[Recovery abort] PROVIDER_STREAM_BLOCK_CLOSED: Provider emitted delta after closing virtual:reasoning.',
        {
          cause: new Error('Provider emitted delta after closing virtual:reasoning.'),
          category: 'stream_protocol',
          attempts: 1,
          maxAttempts: 1,
          streamCode: 'PROVIDER_STREAM_BLOCK_CLOSED',
        },
      ),
    );
    expect(diagnostic.code).toBe('CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION');
    expect(diagnostic.userMessage).toContain('完整性');
    expect(diagnostic.userMessage).toContain('PROVIDER_STREAM_BLOCK_CLOSED');
    expect(diagnostic.userMessage).toContain('anthropic/claude-opus-5');
    expect(diagnostic.userMessage).toContain('与账号、额度或网络无关');
    expect(diagnostic.userMessage).not.toContain('请检查该账号');
  });

  it('does not disguise attachment failures as provider request failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new Error('VISION_INPUT_UNSUPPORTED: the selected model route does not accept image attachments.'),
    );
    expect(diagnostic.code).toBe('VISION_INPUT_UNSUPPORTED');
    expect(diagnostic.userMessage).not.toContain('额度或网络');
  });

  it('classifies Mission completion denial independently from provider failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      { agentId: 'debugger', providerId: 'anthropic', modelId: 'claude-opus-5' },
      new MissionCompletionError('missing_report', 'debugger cannot complete without a ready report'),
    );
    expect(diagnostic.code).toBe('MISSION_COMPLETION_DENIED');
    expect(diagnostic.userMessage).toContain('本次调查尚未完成');
    expect(diagnostic.userMessage).not.toContain('额度或网络');
  });

  it('classifies raw ProviderStreamProtocolError the same way', () => {
    const error = new Error('Provider emitted delta after closing virtual:reasoning.');
    error.name = 'ProviderStreamProtocolError';
    (error as { code?: string }).code = 'PROVIDER_STREAM_BLOCK_CLOSED';
    const diagnostic = createTurnFailedDiagnostic(ROUTE, error);
    expect(diagnostic.code).toBe('CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION');
    expect(diagnostic.userMessage).not.toContain('请检查该账号');
  });

  it('classifies capacity / high demand as overloaded with a specific userMessage', () => {
    const original = new ProviderWireFailureError(
      'openai-responses',
      'The model is currently at capacity due to high demand. Please try again in a few minutes',
      {
        bodyText: '{"type":"error","message":"The model is currently at capacity due to high demand."}',
      },
    );
    const abort = new AgentRecoveryAbortError('[Recovery abort] overloaded retries exhausted', {
      cause: original,
      category: 'overloaded',
      attempts: 3,
      maxAttempts: 3,
      bodySnippet: original.bodyText,
    });
    const diagnostic = createTurnFailedDiagnostic(
      { agentId: 'plan', providerId: 'grok-account', modelId: 'grok-4.6' },
      abort,
    );
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('过载或容量不足');
    expect(diagnostic.userMessage).not.toContain('请检查该账号');
    expect(diagnostic.technicalMessage).toBe(
      'provider HTTP n/a · attempts 3/3 · {"type":"error","message":"The model is currently at capacity due to high demand."}',
    );
  });

  it('classifies ProviderWireFailureError abort with provider HTTP n/a technicalMessage', () => {
    const original = new ProviderWireFailureError(
      'openai-responses',
      'Account suspended by provider',
      { code: 'account_suspended', bodyText: '{"code":"account_suspended"}' },
    );
    const abort = new AgentRecoveryAbortError('[Recovery abort] unrecoverable error', {
      cause: original,
      category: 'unknown',
      attempts: 1,
      maxAttempts: 1,
      bodySnippet: original.bodyText,
    });
    const diagnostic = createTurnFailedDiagnostic(ROUTE, abort);
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('模型请求失败');
    expect(diagnostic.technicalMessage).toBe(
      'provider HTTP n/a · attempts 1/1 · {"code":"account_suspended"}',
    );
  });
});
