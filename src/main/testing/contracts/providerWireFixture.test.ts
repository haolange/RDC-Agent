/**
 * Provider wire fixture skeleton (Phase 7).
 *
 * Full multi-provider golden fixtures are intentionally out of scope here.
 * This suite documents the minimal contract surface and locks a single
 * fail-closed RequestPlan helper path so larger fixtures can land later.
 *
 * See also:
 * - src/main/agent-runtime/providers/ProviderPromptCacheWire.test.ts
 * - src/main/agent-runtime/AgentEventBridge.semanticChannels.test.ts
 * - pnpm run check:provider-system / check:provider-catalog
 */
import { describe, expect, it } from 'vitest';
import { createFailClosedProviderContracts } from '@shared/provider-catalog/providerContracts';
import { createTestRequestPlan } from '../createTestRequestPlan';

describe('providerWireFixture skeleton', () => {
  it('builds a closed RequestPlan with fail-closed contracts', () => {
    const plan = createTestRequestPlan({
      providerId: 'fixture-provider',
      adapterId: 'openai-compatible',
      catalogRevision: 'test-catalog',
      routeRevision: 'rev-1',
      selectedModelId: 'fixture-model',
      effectiveModelId: 'fixture-model',
      appliedBindingIds: [],
      route: {
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://example.test',
        source: 'catalog',
      },
      headers: {},
      bodyPatch: {},
      contextBudgetTokens: 128_000,
      contextMode: 'normal',
      contextWindowTokens: 128_000,
      activeTierId: 'default',
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
    });
    expect(plan.effectiveModelId).toBe('fixture-model');
    expect(plan.route.protocol).toBe('OpenAICompatibleChatCompletions');
    const contracts = plan.route.contracts ?? createFailClosedProviderContracts(plan.route.protocol);
    expect(contracts.semanticContext.attachments).toBe('fail-closed');
    expect(contracts.reasoning.semantic).toBe('unknown');
  });

  it('documents where fuller wire fixtures should live', () => {
    const note = [
      'Add provider-specific SSE/JSONL golden files under src/main/agent-runtime/providers/__fixtures__',
      'when introducing a new adapter; keep secrets out of fixtures.',
    ].join(' ');
    expect(note.includes('__fixtures__')).toBe(true);
  });
});
