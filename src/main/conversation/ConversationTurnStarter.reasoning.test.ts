import { beforeEach, expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { planModelRequest } from '../settings/provider-catalog/RequestPlanner';
import { startProfileTurn } from './ConversationTurnStarter';

const fixture = vi.hoisted(() => ({ level: 'high', model: null as unknown as EffectiveModel, preparedControls: null as unknown }));
vi.mock('electron', () => ({ app: { getPath: () => '.', getAppPath: () => '.' }, BrowserWindow: class {} }));
vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({ llm: { providers: [] } }) } }));
vi.mock('../agent-runtime/orchestration/AgentOrchestrator', () => ({ agentOrchestrator: { refreshProviderRuntimeCredentials: async () => 'lease' } }));
vi.mock('../provider-catalog/ProviderCatalogRegistry', () => ({ loadProviderSurface: async () => ({}) }));
vi.mock('../settings/settings-core/compactionPercent', () => ({ resolveCompactionPercentForSettings: () => 80 }));
vi.mock('../settings/provider-catalog/EffectiveModelResolver', () => ({
  resolveEffectiveModel: () => fixture.model,
  planEffectiveModelRequest: ({ controls }: { controls: Parameters<typeof planModelRequest>[0]['controls'] }) => {
    fixture.preparedControls = controls;
    return planModelRequest({ model: fixture.model, controls });
  },
}));
vi.mock('../agent-runtime/capabilities/RouteCapabilityResolver', () => ({ resolveAgentRouteCapability: () => { throw new Error('AFTER_REQUEST_PLAN'); } }));
vi.mock('./ConversationRoutePreflight', () => ({
  resolveConversationAgentId: () => 'general',
  resolveEnabledAgentDefinition: () => ({ id: 'general', reasoningLevel: fixture.level,
    compiledRoute: { providerId: 'provider', modelId: 'model' } }),
  resolveAgentRoutePreflight: () => ({ ok: true, providerId: 'provider', modelId: 'model' }),
}));

const model = {
  providerId: 'provider', modelId: 'model', label: 'Model', aliases: [], enabled: true,
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test/v1', source: 'catalog' },
  availability: 'available', presencePolicy: 'maintained',
  contextTiers: [{ id: 'default', label: 'Default', maxTotalTokens: 100_000, maxOutputTokens: 10_000,
    activation: { kind: 'implicit' }, entitlement: 'granted' }], defaultBudgetTokens: 90_000,
  controls: { fast: { state: 'unsupported', fixedValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
    reasoning: { kind: 'levels', supportsOff: false, levels: ['low', 'high'], defaultSelection: 'low',
      wireProfile: { kind: 'openai-responses', on: 'low', levels: { low: 'low', high: 'high' } } } },
  toolCalling: { state: 'supported' }, visionInput: { state: 'unsupported' },
  structuredOutput: { state: 'supported' }, provenance: [],
} satisfies EffectiveModel;

beforeEach(() => { fixture.level = 'high'; fixture.model = model; fixture.preparedControls = null; });
const start = (controls?: { reasoningLevel: 'low'; fastModel: false; maxContextMode: false }) => startProfileTurn(
  { getPreparingRequestByRequestId: () => undefined } as never, async () => undefined,
  { projectId: null, session: null } as never, 'general', 'general', 'inspect', [], [], undefined, controls,
);

it('passes the Agent default to the actual request planner and rejects silent normalization before execution', async () => {
  await expect(start()).rejects.toThrow('AFTER_REQUEST_PLAN');
  expect(fixture.preparedControls).toMatchObject({ reasoningLevel: 'high' });
  fixture.level = 'xhigh';
  await expect(start()).rejects.toThrow(/CONSTRAINT_REJECTED.*xhigh/);
  expect(fixture.preparedControls).toMatchObject({ reasoningLevel: 'xhigh' });
  await expect(start({ reasoningLevel: 'low', fastModel: false, maxContextMode: false })).rejects.toThrow('AFTER_REQUEST_PLAN');
  expect(fixture.preparedControls).toMatchObject({ reasoningLevel: 'low' });
});
