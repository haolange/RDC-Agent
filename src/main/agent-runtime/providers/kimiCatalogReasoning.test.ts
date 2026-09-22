import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProviderCatalog } from '@shared/provider-catalog/compiler';
import { loadProviderCatalogManifestInput } from '@shared/provider-catalog/nodeManifestLoader';
import { clampReasoningSelection, createReasoningControl } from '@shared/types/modelCapability';
import { applyAnthropicReasoning, applyOpenAiCompatibleReasoning } from './reasoningWire';

const surface = compileProviderCatalog(loadProviderCatalogManifestInput(path.resolve(
  process.cwd(), 'src/shared/provider-catalog/manifests',
))).surfaces.get('kimi-coding-plan')!.surface;

describe('Kimi K2.8 Preview reasoning from the maintained catalog', () => {
  it('emits explicit Off for both protocols without changing the selected model', () => {
    const model = surface.models.find((entry) => entry.modelId === 'kimi-for-coding')!;
    const anthropic = createReasoningControl({ ...model.controls.reasoning, defaultSelection: 'max' });
    expect(clampReasoningSelection('off', anthropic)).toBe('off');
    const anthropicBody: Record<string, unknown> = { model: model.modelId };
    applyAnthropicReasoning(anthropicBody, { selection: 'off', control: anthropic });
    expect(anthropicBody).toEqual({ model: 'kimi-for-coding', thinking: { type: 'disabled' } });

    const chat = createReasoningControl({
      ...surface.protocolOverrides.find((entry) => entry.modelId === model.modelId
        && entry.protocol === 'OpenAICompatibleChatCompletions')!.patch.controls!.reasoning!,
      defaultSelection: 'max',
    });
    expect(clampReasoningSelection('off', chat)).toBe('off');
    const chatBody: Record<string, unknown> = { model: model.modelId };
    applyOpenAiCompatibleReasoning(chatBody, { selection: 'off', control: chat });
    expect(chatBody).toEqual({ model: 'kimi-for-coding', thinking: { type: 'disabled' } });
    expect(model.liveProjection?.reasoning?.wireProfiles.AnthropicMessages).toMatchObject({ offMode: 'disabled' });
    expect(model.liveProjection?.reasoning?.wireProfiles.OpenAICompatibleChatCompletions)
      .toMatchObject({ offMode: 'thinking-disabled' });
  });

  it('keeps K3 Off forbidden because that would route to another model', () => {
    for (const id of ['k3', 'k3-256k']) {
      const model = surface.models.find((entry) => entry.modelId === id)!;
      expect(model.controls.reasoning.supportsOff).toBe(false);
      expect(model.liveProjection?.reasoning?.offPolicy).toBe('forbidden');
    }
  });
});
