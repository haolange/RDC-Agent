import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseCopilotBillingContribution,
  parseCopilotBillingTiers,
  parseCopilotModelCatalog,
} from './CopilotBilling';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copilot-models.json'), 'utf8')) as unknown;

describe('Copilot account catalog parser', () => {
  it('projects only account-advertised visibility, routes, controls, and capabilities', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(catalog.models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5-mini',
      'claude-opus-4.8',
      'claude-opus-4.8-fast',
      'claude-opus-4.6',
    ]);
    expect(catalog.models.find((model) => model.id === 'claude-opus-4.6')).toMatchObject({
      availability: 'unavailable',
      availabilityReason: expect.stringContaining('current Copilot account'),
    });

    const gpt = catalog.contributions.find((model) => model.modelId === 'gpt-5.5');
    expect(gpt).toMatchObject({
      availability: 'available',
      routeOptions: [
        expect.objectContaining({
          id: 'OpenAICompatibleChatCompletions',
          route: expect.objectContaining({ baseUrl: 'https://api.githubcopilot.com' }),
        }),
        expect.objectContaining({
          id: 'OpenAIResponses',
          route: expect.objectContaining({ baseUrl: 'https://api.githubcopilot.com' }),
        }),
      ],
      controls: {
        reasoning: {
          kind: 'levels', supportsOff: true,
          levels: ['low', 'medium', 'high', 'xhigh'], defaultSelection: 'high',
        },
      },
      toolCalling: { state: 'supported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
    });
    expect(gpt).not.toHaveProperty('executionBindings');
    expect(gpt).not.toHaveProperty('contextTiers');

    const fastTarget = catalog.contributions.find((model) => model.modelId === 'claude-opus-4.8-fast');
    expect(fastTarget).toMatchObject({ availability: 'available' });
    expect(fastTarget).not.toHaveProperty('selection');
    expect(fastTarget).not.toHaveProperty('executionBindings');
  });

  it('parses account-specific default and long-context billing rows', () => {
    const catalog = parseCopilotModelCatalog(fixture);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5.5'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, maxOutputTokens: 128_000, maxTotalTokens: 400_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
      { id: 'long_context', label: 'Long context', maxPromptTokens: 922_000, maxOutputTokens: 128_000, maxTotalTokens: 1_050_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
    expect(parseCopilotBillingTiers(catalog.billingByModel['gpt-5-mini'])).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, maxOutputTokens: 64_000, maxTotalTokens: 336_000, activation: { kind: 'implicit' }, entitlement: 'unknown' },
    ]);
    expect(parseCopilotBillingContribution('gpt-5.5', catalog.billingByModel['gpt-5.5']))
      .toMatchObject({
        controls: {
          maxContext: { state: 'selectable', tierId: 'long_context', entitlement: 'unknown' },
        },
        executionBindings: [{
          id: 'context:copilot-long-context',
          when: { maxContext: true },
          actions: [{ kind: 'client-tier', tierId: 'long_context' }],
          entitlement: 'unknown',
        }],
      });
    expect(parseCopilotBillingContribution('gpt-5-mini', catalog.billingByModel['gpt-5-mini']))
      .toMatchObject({ controls: { maxContext: { state: 'unsupported', fixedValue: false } } });
  });

  it('parses a Gemini 3.5 billing threshold without declaring structural controls', () => {
    const catalog = parseCopilotModelCatalog({
      data: [{
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        model_picker_enabled: true,
        supported_endpoints: ['/chat/completions'],
        capabilities: {
          type: 'chat',
          limits: {
            max_prompt_tokens: 200_000,
            max_output_tokens: 64_000,
            max_context_window_tokens: 264_000,
          },
        },
        billing: {
          token_prices: {
            default: { context_max: 200_000, entitlement: 'granted' },
          },
        },
      }],
    });

    expect(parseCopilotBillingTiers(catalog.billingByModel['gemini-3.5-flash'])).toEqual([{
      id: 'default',
      label: 'Default',
      maxPromptTokens: 200_000,
      maxOutputTokens: 64_000,
      maxTotalTokens: 264_000,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }]);
    expect(catalog.contributions[0]).not.toHaveProperty('controls');
  });

  it('lets an account policy denial dominate incomplete billing metadata', () => {
    expect(parseCopilotBillingTiers({
      limits: { maxPromptTokens: 272_000, maxTotalTokens: 1_000_000 },
      tokenPrices: { default: { context_max: 272_000 } },
      entitlement: 'denied',
    })).toEqual([expect.objectContaining({ entitlement: 'denied' })]);
  });

  it('does not infer fixed 1M or Fast from Copilot model names', () => {
    const catalog = parseCopilotModelCatalog({
      data: ['claude-sonnet-5', 'claude-opus-4.8-fast', 'unverified-model'].map((id) => ({
        id,
        model_picker_enabled: true,
        supported_endpoints: ['/chat/completions'],
        capabilities: { type: 'chat', supports: {} },
      })),
    });
    for (const contribution of catalog.contributions) {
      expect(contribution).not.toHaveProperty('controls');
      expect(contribution).not.toHaveProperty('executionBindings');
      expect(contribution).not.toHaveProperty('contextTiers');
    }
  });

  it('selects the only account-advertised route instead of retaining an unsupported provider default', () => {
    const catalog = parseCopilotModelCatalog({
      data: [{
        id: 'responses-only-model',
        model_picker_enabled: true,
        supported_endpoints: ['/responses'],
        capabilities: { type: 'chat', supports: {}, limits: { max_context_window_tokens: 128_000 } },
      }],
    });

    expect(catalog.contributions).toEqual([
      expect.objectContaining({
        modelId: 'responses-only-model',
        preferredRouteOptionId: 'OpenAIResponses',
        routeOptions: [expect.objectContaining({ id: 'OpenAIResponses' })],
      }),
    ]);
  });

  it('admits Opus 5 only from an exact account row with an advertised agent endpoint', () => {
    const catalog = parseCopilotModelCatalog({
      data: [
        {
          id: 'claude-opus-5',
          name: 'Claude Opus 5',
          model_picker_enabled: true,
          supported_endpoints: ['/v1/messages'],
          capabilities: { type: 'chat' },
        },
        {
          id: 'claude-opus-5-without-route',
          name: 'Claude Opus 5 without route',
          model_picker_enabled: true,
          capabilities: { type: 'chat' },
        },
      ],
    });

    expect(catalog.models.map((model) => model.id)).toEqual(['claude-opus-5']);
    expect(catalog.contributions).toEqual([
      expect.objectContaining({
        modelId: 'claude-opus-5',
        preferredRouteOptionId: 'AnthropicMessages',
        routeOptions: [expect.objectContaining({ id: 'AnthropicMessages' })],
      }),
    ]);
  });
});
