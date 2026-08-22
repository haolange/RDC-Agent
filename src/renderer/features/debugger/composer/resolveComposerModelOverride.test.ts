import { describe, expect, it } from 'vitest';
import type { AgentModelOption } from '@shared/types/agentManifest';
import { resolveComposerModelOverride } from './resolveComposerModelOverride';

function option(partial: Partial<AgentModelOption> & Pick<AgentModelOption, 'providerId' | 'modelId'>): AgentModelOption {
  return {
    canonicalId: `${partial.providerId}:${partial.modelId}`,
    providerLabel: partial.providerId,
    modelLabel: partial.modelId,
    configured: true,
    status: 'ready',
    ...partial,
  };
}

describe('resolveComposerModelOverride', () => {
  const options = [
    option({ providerId: 'chatgpt-account', modelId: 'gpt-5.6-sol', status: 'model-unverified' }),
    option({ providerId: 'openai', modelId: 'gpt-5.6-sol', status: 'ready' }),
    option({ providerId: 'kimi-coding-plan', modelId: 'kimi-for-coding', status: 'model-unverified' }),
    option({ providerId: 'openai', modelId: 'hidden', status: 'model-unavailable' }),
  ];

  it('accepts unverified account models by canonical id', () => {
    expect(resolveComposerModelOverride('chatgpt-account:gpt-5.6-sol', options)).toEqual({
      providerId: 'chatgpt-account',
      modelId: 'gpt-5.6-sol',
    });
  });

  it('rejects denied models and ambiguous bare ids', () => {
    expect(resolveComposerModelOverride('openai:hidden', options)).toBeNull();
    expect(resolveComposerModelOverride('gpt-5.6-sol', options)).toBeNull();
    expect(resolveComposerModelOverride('kimi-for-coding', options)).toEqual({
      providerId: 'kimi-coding-plan',
      modelId: 'kimi-for-coding',
    });
  });
});
