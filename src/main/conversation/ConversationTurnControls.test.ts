import { expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { planModelRequest } from '../settings/provider-catalog/RequestPlanner';
import { assertAgentReasoningHonored, conversationTurnControlInput } from './ConversationTurnControls';

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

it('uses the Agent default, rejects a changed request plan and permits an explicit turn override', () => {
  const configured = conversationTurnControlInput('high', null, undefined);
  const valid = planModelRequest({ model, controls: configured });
  expect(valid.ok).toBe(true);
  if (!valid.ok) throw new Error(valid.message);
  expect(valid.plan.reasoningWire.selection).toBe('high');
  expect(() => assertAgentReasoningHonored('high', configured, valid.plan.reasoningWire.selection)).not.toThrow();

  const unsupported = conversationTurnControlInput('xhigh', null, undefined);
  const normalized = planModelRequest({ model, controls: unsupported });
  expect(normalized.ok).toBe(true);
  if (!normalized.ok) throw new Error(normalized.message);
  expect(normalized.plan.reasoningWire.selection).toBe('high');
  expect(() => assertAgentReasoningHonored('xhigh', unsupported, normalized.plan.reasoningWire.selection)).toThrow(/CONSTRAINT_REJECTED/);
  expect(() => assertAgentReasoningHonored('high', configured, 'unknown')).toThrow(/unverified/);

  const override = conversationTurnControlInput('xhigh', null, { reasoningLevel: 'low', fastModel: false, maxContextMode: false });
  const overriddenPlan = planModelRequest({ model, controls: override });
  expect(overriddenPlan.ok).toBe(true);
  if (!overriddenPlan.ok) throw new Error(overriddenPlan.message);
  expect(overriddenPlan.plan.reasoningWire.selection).toBe('low');
  expect(() => assertAgentReasoningHonored('xhigh', override, overriddenPlan.plan.reasoningWire.selection)).not.toThrow();
});
