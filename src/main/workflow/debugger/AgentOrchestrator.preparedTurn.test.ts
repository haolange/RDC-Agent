import { describe, expect, it, vi } from 'vitest';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

import { AgentOrchestrator } from './AgentOrchestrator';

const requestPlan: RequestPlan = {
  providerId: 'provider',
  adapterId: 'openai-responses',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: 'model',
  effectiveModelId: 'model',
  appliedBindingIds: [],
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
  headers: {
    Authorization: 'Bearer must-not-persist',
    'api-key': 'must-not-persist',
    'anthropic-beta': 'context-1m',
  },
  bodyPatch: {},
  contextBudgetTokens: 256_000,
  contextMode: 'normal',
  contextWindowTokens: 500_000,
  activeTierId: 'normal',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
  },
};

const effectiveModel: EffectiveModel = {
  providerId: 'provider',
  modelId: 'model',
  label: 'Model',
  aliases: [],
  enabled: true,
  route: requestPlan.route,
  availability: 'available',
  presencePolicy: 'maintained',
  contextTiers: [{
    id: 'normal',
    label: 'Normal',
    maxPromptTokens: 256_000,
    maxOutputTokens: 244_000,
    activation: { kind: 'implicit' },
    entitlement: 'granted',
  }],
  defaultBudgetTokens: 256_000,
  controls: {
    fast: { state: 'unsupported', fixedValue: false },
    context1m: { state: 'unsupported', fixedValue: false },
    reasoning: requestPlan.reasoningWire.control,
  },
  toolCalling: { state: 'supported' },
  visionInput: { state: 'supported' },
  structuredOutput: { state: 'supported' },
  provenance: [],
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

const baseInput = {
  requestId: 'request-1',
  credentialHandle: 'credential-1',
  turnId: 'turn-1',
  agentId: 'ask' as const,
  content: 'inspect the active capture',
  imageTokenAdjustment: 0,
  providerId: 'provider',
  selectedModelId: 'model',
  effectiveModel,
  routeCapability,
  requestPlan,
  turnControls: { reasoningLevel: 'off' as const, maxContextMode: false, fastModel: false },
  promptPlan: {
    id: 'prompt-plan',
    segments: [],
    systemPrompt: 'system',
    totalTokenEstimate: 20,
    metrics: { systemPrompt: 24, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  },
  toolAllowlist: [],
  projectRootPath: null,
  sessionId: null,
  visibleTurnIds: [],
  activeBranchId: 'root',
};

describe('AgentOrchestrator prepared turn context', () => {
  it('freezes the effective route and keeps provider window separate from prompt budget', async () => {
    const result = await new AgentOrchestrator().prepareTurnContext(baseInput);
    expect(result.summary).toMatchObject({
      requestId: 'request-1',
      turnId: 'turn-1',
      promptBudgetTokens: 256_000,
      contextWindowTokens: 500_000,
      contextMode: 'normal',
      compactionApplied: false,
      route: {
        providerId: 'provider',
        selectedModelId: 'model',
        effectiveModelId: 'model',
        protocol: 'OpenAIResponses',
      },
    });
    expect(result.initialMessages).toEqual([]);
    expect(result.runtime.credentialHandle).toBe('credential-1');
    expect(result.summary.wirePatch.headers).toEqual({ 'anthropic-beta': 'context-1m' });
    expect(result.summary.breakdown.some((entry) => entry.id === 'free')).toBe(true);
  });

  it('fails before persistence when fixed prompt overhead leaves no message budget', async () => {
    await expect(new AgentOrchestrator().prepareTurnContext({
      ...baseInput,
      requestPlan: { ...requestPlan, contextBudgetTokens: 100 },
      promptPlan: {
        ...baseInput.promptPlan,
        totalTokenEstimate: 100,
        metrics: { systemPrompt: 400, scopedInstructions: 0, skills: 0 },
      },
    })).rejects.toThrow(/^PROMPT_OVERHEAD_EXCEEDS_BUDGET:/u);
  });

  it('honors cancellation before any runtime preparation work begins', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new AgentOrchestrator().prepareTurnContext({
      ...baseInput,
      signal: controller.signal,
    })).rejects.toThrow(/^REQUEST_CANCELLED:/u);
  });
});
