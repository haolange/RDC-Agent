import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { compileProviderCatalog } from '@shared/provider-catalog/compiler';
import { loadProviderCatalogManifestInput } from '@shared/provider-catalog/nodeManifestLoader';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { applyAnthropicReasoning, applyOpenAiCompatibleReasoning, buildOpenAiResponsesReasoning } from '../agent-runtime/providers/reasoningWire';
import { applyRequestPlanBody } from '../agent-runtime/providers/requestPlanWire';
import { planModelRequest } from './RequestPlanner';

const catalog = compileProviderCatalog(loadProviderCatalogManifestInput(
  resolve(__dirname, '../../shared/provider-catalog/manifests'),
));

function effective(providerId: string, modelId: string, protocol?: LlmProviderProtocol): EffectiveModel {
  const surface = catalog.surfaces.get(providerId)!.surface;
  const definition = surface.models.find((model) => model.modelId === modelId)!;
  const route = surface.routes.find((entry) => entry.protocol === (protocol ?? definition.route.protocol))!;
  const overlay = surface.protocolOverrides.find((entry) => entry.modelId === modelId && entry.protocol === protocol);
  const reasoning = overlay?.patch.controls?.reasoning ?? definition.controls.reasoning;
  return {
    ...definition,
    providerId, enabled: true, availability: 'available', provenance: [],
    route: { ...route, source: 'catalog' },
    routeOptions: undefined,
    controls: {
      ...definition.controls,
      reasoning: { ...reasoning, defaultSelection: reasoning.defaultSelection ?? 'off' },
    },
  } as EffectiveModel;
}

function wire(plan: RequestPlan): Record<string, unknown> {
  const body: Record<string, unknown> = { model: plan.effectiveModelId, top_p: 0.97, temperature: 0.6 };
  applyAnthropicReasoning(body, plan.reasoningWire);
  applyOpenAiCompatibleReasoning(body, plan.reasoningWire);
  Object.assign(body, buildOpenAiResponsesReasoning(plan.reasoningWire));
  return applyRequestPlanBody(body, plan);
}

describe('reviewed provider catalog request paths', () => {
  for (const modelId of ['deepseek-flash', 'deepseek-v4-pro']) {
    for (const protocol of ['OpenAIResponses', 'OpenAICompatibleChatCompletions', 'AnthropicMessages'] as const) {
      it(`${modelId} preserves sampling and maps on/off through ${protocol}`, () => {
        const model = effective('deepseek', modelId, protocol);
        for (const level of ['off', 'low', 'high', 'max'] as const) {
          const result = planModelRequest({ model, controls: { reasoningLevel: level } });
          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error(result.message);
          const body = wire(result.plan);
          expect(body.top_p).toBe(0.97);
          if (level !== 'off') expect(body).not.toHaveProperty('temperature');
          if (protocol === 'OpenAIResponses') {
            expect(body.reasoning).toEqual({ effort: level === 'off' ? 'none' : level });
            expect(result.plan.executionIdentity.stateMode).toBe('local-stateless');
          } else {
            expect(body.thinking).toEqual({ type: level === 'off' ? 'disabled' : 'enabled' });
            if (level !== 'off') {
              if (protocol === 'AnthropicMessages') expect(body.output_config).toEqual({ effort: level });
              else expect(body.reasoning_effort).toBe(level);
            }
          }
        }
        expect(model.visionInput.state).toBe(modelId === 'deepseek-flash' ? 'supported' : 'unsupported');
      });
    }
  }

  it('activates xAI Priority without granting it to Grok OAuth', () => {
    const direct = planModelRequest({ model: effective('xai', 'grok-4.7'), controls: { fastModel: true } });
    expect(direct.ok).toBe(true);
    if (!direct.ok) throw new Error(direct.message);
    expect(wire(direct.plan).service_tier).toBe('priority');
    const account = planModelRequest({ model: effective('grok-account', 'grok-4.7'), controls: { fastModel: true } });
    expect(account.ok).toBe(true);
    if (!account.ok) throw new Error(account.message);
    expect(account.plan.fastMode).toBe(false);
    expect(wire(account.plan)).not.toHaveProperty('service_tier');
  });

  for (const surfaceId of ['glm-global-coding-plan']) {
    it(`${surfaceId} sends each exposed GLM effort and recommends executable identities`, () => {
      const surface = catalog.surfaces.get(surfaceId)!.surface;
      expect(surface.recommendedModels).toEqual(['glm-5.3', 'glm-5.3-flash']);
      for (const level of ['low', 'high', 'max'] as const) {
        const model = effective(surfaceId, 'glm-5.3');
        const result = planModelRequest({ model, controls: { reasoningLevel: level } });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(wire(result.plan).output_config).toEqual({ effort: level });
      }
    });
  }

  it('fails closed for GLM CN while its context limit remains unverified', () => {
    const model = effective('glm-cn-coding-plan', 'glm-5.3');
    expect(model.defaultBudgetTokens).toBe(0);
    expect(model.visionInput.state).toBe('unknown');
    expect(planModelRequest({ model }).ok).toBe(false);
  });

  for (const surfaceId of ['minimax-cn', 'minimax-global', 'minimax-cn-coding-plan', 'minimax-global-coding-plan']) {
    it(`${surfaceId} leaves unresolved M3 reasoning to the provider on both routes`, () => {
      for (const protocol of ['AnthropicMessages', 'OpenAICompatibleChatCompletions'] as const) {
        const result = planModelRequest({ model: effective(surfaceId, 'MiniMax-M3', protocol) });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.plan.reasoningWire.selection).toBe('unknown');
        const body = wire(result.plan);
        for (const key of ['thinking', 'reasoning', 'reasoning_effort', 'output_config']) {
          expect(body).not.toHaveProperty(key);
        }
      }
    });
  }
});
