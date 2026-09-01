import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types/settings';

vi.mock('./AgentManifestService', () => ({
  agentManifestService: {
    resolveEffectiveSnapshot: vi.fn(),
  },
}));

import { agentManifestService } from './AgentManifestService';
import {
  compiledRouteFromDefinition,
  compiledRoutesFromDefinitions,
  resolveCompiledRouteForAgent,
} from './compiledAgentRoutes';

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
    const settings = {
      paths: { agentsPath: 'C:/agents', instructionsPath: 'C:/RDX.md' },
      agents: { definitions: [{ id: 'general', compiledRoute: { agentId: 'general', providerId: 'real', modelId: 'real-model' } }] },
      llm: { agentRoutes: [{ agentId: 'general', providerId: 'leftover', modelId: 'leftover-model' }] },
    } as unknown as AppSettings;
    expect(resolveCompiledRouteForAgent('general', settings, 'D:/Project')).toEqual({
      agentId: 'general',
      providerId: 'real',
      modelId: 'real-model',
    });
    expect(vi.mocked(agentManifestService.resolveEffectiveSnapshot)).toHaveBeenCalledWith(
      settings.paths,
      'D:/Project',
    );
  });
});
