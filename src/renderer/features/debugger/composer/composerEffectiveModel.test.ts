import { describe, expect, it } from 'vitest';
import { readCompiledComposerRoute, resolveComposerEffectiveModel } from './composerEffectiveModel';

describe('composer compiled route snapshot', () => {
  it('reads compiledRoute from the effective definition and ignores leftover agentRoutes', () => {
    const settings = {
      agents: {
        definitions: [{
          id: 'general',
          compiledRoute: { providerId: 'project-provider', modelId: 'project-model' },
        }],
      },
      llm: {
        agentRoutes: [{ agentId: 'general', providerId: 'user-leftover', modelId: 'user-leftover-model' }],
      },
    };
    expect(readCompiledComposerRoute(settings, 'general')).toEqual({
      providerId: 'project-provider',
      modelId: 'project-model',
    });
    expect(resolveComposerEffectiveModel(null, null, readCompiledComposerRoute(settings, 'general'))).toEqual({
      providerId: 'project-provider',
      modelId: 'project-model',
    });
  });
});
