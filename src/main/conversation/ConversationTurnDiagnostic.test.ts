import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({ agents: { definitions: [] } }),
  },
}));
import { AgentRecoveryAbortError } from '../agent-runtime/agent/ErrorRecovery';
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';
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

  it('keeps genuine provider failures on the provider diagnostic', () => {
    const diagnostic = createTurnFailedDiagnostic(ROUTE, new Error('429 quota exceeded'));
    expect(diagnostic.code).toBe('CONVERSATION_LLM_REQUEST_FAILED');
    expect(diagnostic.userMessage).toContain('模型请求失败');
    expect(diagnostic.technicalMessage).toBe('429 quota exceeded');
  });

  it('classifies stream protocol violations independently from account failures', () => {
    const diagnostic = createTurnFailedDiagnostic(
      ROUTE,
      new AgentRecoveryAbortError(
        '[Recovery abort] PROVIDER_STREAM_BLOCK_CLOSED: Provider emitted delta after closing virtual:reasoning.',
        'PROVIDER_STREAM_BLOCK_CLOSED',
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
    expect(diagnostic.userMessage).toContain('不能把本次 Mission 标为已完成');
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
});
