import { describe, expect, it } from 'vitest';
import { hasComposerModelChoice, resolveComposerEffectiveModel } from './composerEffectiveModel';

describe('resolveComposerEffectiveModel', () => {
  const agentRoute = { providerId: 'kimi-coding-plan', modelId: 'kimi-k2.7-code' };
  const draft = { providerId: 'chatgpt-account', modelId: 'gpt-5.6-sol' };
  const session = { providerId: 'openai', modelId: 'gpt-5.6-luna' };

  it('prefers session, then draft, then the Agent seed', () => {
    expect(resolveComposerEffectiveModel(session, draft, agentRoute)).toEqual(session);
    expect(resolveComposerEffectiveModel(null, draft, agentRoute)).toEqual(draft);
    expect(resolveComposerEffectiveModel(null, null, agentRoute)).toEqual(agentRoute);
    expect(resolveComposerEffectiveModel(null, null, null)).toBeNull();
  });

  it('ignores empty fragments', () => {
    expect(resolveComposerEffectiveModel({ providerId: '', modelId: 'x' }, draft, agentRoute)).toEqual(draft);
    expect(hasComposerModelChoice(null, null)).toBe(false);
    expect(hasComposerModelChoice(null, draft)).toBe(true);
    expect(hasComposerModelChoice(session, null)).toBe(true);
  });
});
