import { describe, expect, it, vi } from 'vitest';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({ agents: { definitions: [] } }),
  },
}));
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';
import { createTurnFailedDiagnostic } from './ConversationRoutePreflight';

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
});
