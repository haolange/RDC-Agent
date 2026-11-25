import { describe, expect, it, vi } from 'vitest';

import { agentManifestService } from '../agent-manifests/AgentManifestService';
import {
  compiledRouteFromDefinition,
  compiledRoutesFromDefinitions,
  resolveCompiledRouteForAgent,
} from './compiledAgentRoutes';

vi.mock('../agent-manifests/AgentManifestService', () => ({
  agentManifestService: {
    resolveEffectiveSnapshot: vi.fn(),
  },
}));

describe('compiledAgentRoutes leftover isolation', () => {
  it('reads compiledRoute and never leftover agentRoutes', () => {
    const leftover = [{ agentId: 'general', providerId: 'leftover', modelId: 'leftover-model' }];
    const definitions = [{
      id: 'general',
      compiledRoute: { agentId: 'general', providerId: 'real', modelId: 'real-model' },
    }];
    expect(compiledRouteFromDefinition(definitions[0])).toEqual({
      agentId: 'general',
      providerId: 'real',
      modelId: 'real-model',
    });
    expect(compiledRoutesFromDefinitions(definitions)).toEqual([
      { agentId: 'general', providerId: 'real', modelId: 'real-model' },
    ]);
    expect(compiledRoutesFromDefinitions(definitions)).not.toEqual(leftover);
  });

  it('resolveCompiledRouteForAgent uses the snapshot compiledRoute instead of leftover agentRoutes', () => {
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{
        id: 'general',
        compiledRoute: { agentId: 'general', providerId: 'real', modelId: 'real-model' },
      }],
      diagnostics: [],
    } as never);
    expect(resolveCompiledRouteForAgent('general', 'D:/Project')).toEqual({
      agentId: 'general',
      providerId: 'real',
      modelId: 'real-model',
    });
    expect(vi.mocked(agentManifestService.resolveEffectiveSnapshot)).toHaveBeenCalledWith(
      expect.objectContaining({ agentsPath: expect.any(String) }),
      'D:/Project',
    );
  });
});
