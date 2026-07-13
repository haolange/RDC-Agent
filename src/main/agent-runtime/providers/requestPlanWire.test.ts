import { describe, expect, it } from 'vitest';
import type { RequestPlan } from '@shared/types/providerCapability';
import { applyRequestPlanBody, requestPlanHeaders } from './requestPlanWire';

const plan: RequestPlan = {
  providerId: 'anthropic',
  effectiveModelId: 'claude-test',
  route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test', source: 'preset' },
  headers: { 'anthropic-beta': 'context-1m', authorization: 'must-not-pass' },
  bodyPatch: { thinking: { type: 'enabled', budget_tokens: 4096 } },
  contextBudgetTokens: 1_000_000,
  activeTierId: 'max',
  fastMode: false,
  reasoningWire: {
    selection: 'high',
    control: { kind: 'levels', supportsOff: true, levels: ['high'], defaultSelection: 'high', wireProfile: { kind: 'none' } },
  },
};

describe('requestPlanWire', () => {
  it('applies declarative body patches without dropping the base request', () => {
    expect(applyRequestPlanBody({ model: 'claude-test', thinking: { type: 'disabled' } }, plan)).toEqual({
      model: 'claude-test',
      thinking: { type: 'enabled', budget_tokens: 4096 },
    });
  });

  it('passes activation headers but rejects credential injection', () => {
    expect(requestPlanHeaders(plan)).toEqual({ 'anthropic-beta': 'context-1m' });
  });
});
