import { describe, expect, it } from 'vitest';
import type { RequestPlan } from '@shared/types/providerCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';

const plan = createTestRequestPlan({
  providerId: 'anthropic',
  adapterId: 'anthropic-messages',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: 'claude-test',
  effectiveModelId: 'claude-test',
  appliedBindingIds: [],
  route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test', source: 'catalog' },
  headers: {
    'anthropic-beta': 'context-1m',
    authorization: 'must-not-pass',
    'x-goog-api-key': 'must-not-pass',
    'x-amz-security-token': 'must-not-pass',
    cookie: 'must-not-pass',
  },
  bodyPatch: { thinking: { type: 'enabled', budget_tokens: 4096 } },
  contextBudgetTokens: 1_000_000,
  contextMode: 'one-million',
  contextWindowTokens: 1_000_000,
  activeTierId: 'max',
  fastMode: false,
  reasoningWire: {
    selection: 'high',
    control: { kind: 'levels', supportsOff: true, levels: ['high'], defaultSelection: 'high', wireProfile: { kind: 'none' } },
  },
});

describe('requestPlanWire', () => {
  it('applies declarative body patches without dropping the base request', () => {
    expect(applyRequestPlanBody({ model: 'claude-test', thinking: { type: 'disabled' } }, plan)).toEqual({
      model: 'claude-test',
      thinking: { type: 'enabled', budget_tokens: 4096 },
    });
  });

  it('treats null request patches as declarative parameter deletion', () => {
    const suppressionPlan: RequestPlan = {
      ...plan,
      bodyPatch: { temperature: null, top_p: null, max_output_tokens: null },
    };
    expect(applyRequestPlanBody({
      model: 'gpt-5.4-mini',
      temperature: 0.35,
      top_p: 0.9,
      max_output_tokens: 1200,
    }, suppressionPlan)).toEqual({ model: 'gpt-5.4-mini' });
  });
  it('passes activation headers but rejects credential injection', () => {
    expect(requestPlanHeaders(plan)).toEqual({ 'anthropic-beta': 'context-1m' });
  });
});
