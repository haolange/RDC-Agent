import { describe, expect, it, vi } from 'vitest';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { resolveHandoffTurnModelOverride } from './profileHandoffModel';

vi.mock('../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModel: vi.fn((providerId: string, modelId: string) => {
    if (providerId === 'good' && modelId === 'ok') {
      return { providerId, modelId, enabled: true, availability: 'available' };
    }
    if (providerId === 'bad' && modelId === 'internal') {
      return { providerId, modelId, enabled: true, availability: 'available' };
    }
    return null;
  }),
}));

vi.mock('@shared/utils/agentToolCapability', () => ({
  isAgentToolExecutableModel: vi.fn((model: { modelId: string }) => model.modelId === 'ok'),
}));

const settings = {} as never;

describe('handoff model priority', () => {
  it('prefers an executable session modelOverride over declaredModel', () => {
    expect(resolveHandoffTurnModelOverride({
      sessionOverride: { providerId: 'good', modelId: 'ok' },
      declaredModel: 'good:other',
      settings,
    })).toEqual({ providerId: 'good', modelId: 'ok' });
  });

  it('uses declaredModel when session override is absent', () => {
    expect(resolveHandoffTurnModelOverride({
      sessionOverride: null,
      declaredModel: 'good:ok',
      settings,
    })).toEqual({ providerId: 'good', modelId: 'ok' });
  });

  it('falls through to the target route when declaredModel is null', () => {
    expect(resolveHandoffTurnModelOverride({
      sessionOverride: null,
      declaredModel: null,
      settings,
    })).toBeNull();
  });

  it('fails closed on an illegal session override without falling back', () => {
    expect(() => resolveHandoffTurnModelOverride({
      sessionOverride: { providerId: 'bad', modelId: 'internal' },
      declaredModel: 'good:ok',
      settings,
    })).toThrow(HANDOFF_ERROR.MODEL_INVALID);
  });

  it('fails closed on an illegal declaredModel', () => {
    expect(() => resolveHandoffTurnModelOverride({
      sessionOverride: null,
      declaredModel: 'missing:model',
      settings,
    })).toThrow(HANDOFF_ERROR.MODEL_INVALID);
  });
});
