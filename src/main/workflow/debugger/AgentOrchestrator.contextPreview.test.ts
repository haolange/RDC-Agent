import { describe, expect, it } from 'vitest';
import { AgentOrchestrator } from './AgentOrchestrator';

const requestPlan = {
  providerId: 'provider',
  effectiveModelId: 'model',
  route: { protocol: 'OpenAIResponses' as const, baseUrl: 'https://example.test', source: 'preset' as const },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 256_000,
  contextMode: 'normal' as const,
  contextWindowTokens: 500_000,
  activeTierId: 'normal',
  fastMode: false,
  reasoningWire: {
    selection: 'off' as const,
    control: {
      kind: 'none' as const,
      supportsOff: true,
      levels: [],
      defaultSelection: 'off' as const,
      wireProfile: { kind: 'none' as const },
    },
  },
};

const routeCapability = {
  providerId: 'provider',
  modelId: 'model',
  toolCallingMode: 'native-structured' as const,
  reasoningVisibility: 'none' as const,
  reasoningDelivery: 'none' as const,
  reasoningContract: { semantic: 'none' as const, source: 'test', displayLabel: 'None' as const },
  supportsStreaming: true,
  supportsToolResults: true,
  toolCallingUnverified: false,
  visionInputMode: 'native' as const,
  structuredOutputMode: 'native' as const,
};

describe('AgentOrchestrator next-request context preview', () => {
  it('projects prompt budget separately from the complete provider window', async () => {
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.previewNextRequestContext({
      clientRevision: 7,
      agentId: 'ask',
      content: 'inspect the active capture',
      imageTokenAdjustment: 0,
      providerId: 'provider',
      modelId: 'model',
      routeCapability,
      requestPlan,
      turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      promptPlan: {
        id: 'prompt-plan', segments: [], systemPrompt: 'system', totalTokenEstimate: 20,
        metrics: { systemPrompt: 24, scopedInstructions: 0, skills: 0 }, diagnostics: [],
      },
      toolAllowlist: [],
      projectRootPath: null,
      sessionId: null,
      visibleTurnIds: [],
    });
    expect(result).toMatchObject({
      clientRevision: 7,
      status: 'ready',
      promptBudgetTokens: 256_000,
      contextWindowTokens: 500_000,
      contextMode: 'normal',
      willCompact: false,
    });
    expect(result.requestEnvelopeId).toBeTruthy();
    expect(result.breakdown.some((entry) => entry.id === 'free')).toBe(true);
  });

  it('fails closed when fixed prompt overhead leaves no message budget', async () => {
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.previewNextRequestContext({
      clientRevision: 8,
      agentId: 'ask',
      content: 'inspect',
      imageTokenAdjustment: 0,
      providerId: 'provider',
      modelId: 'model',
      routeCapability,
      requestPlan: { ...requestPlan, contextBudgetTokens: 100 },
      turnControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      promptPlan: {
        id: 'prompt-plan', segments: [], systemPrompt: 'system', totalTokenEstimate: 100,
        metrics: { systemPrompt: 400, scopedInstructions: 0, skills: 0 }, diagnostics: [],
      },
      toolAllowlist: [],
      projectRootPath: null,
      sessionId: null,
      visibleTurnIds: [],
    });
    expect(result.status).toBe('blocked');
    expect(result.blockingReason?.code).toBe('PROMPT_OVERHEAD_EXCEEDS_BUDGET');
  });
});
