import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  filterComposerPickerOptions,
  groupComposerPickerOptions,
  hasPickerReasoning,
  isComposerPickerModel,
  resolvePickerContextWindow,
  toComposerPickerOption,
} from './composerModelPicker';

function model(partial: Record<string, unknown> & { modelId: string }): EffectiveModel {
  return {
    providerId: 'openai',
    label: typeof partial.label === 'string' ? partial.label : partial.modelId,
    aliases: [],
    enabled: true,
    availability: 'available',
    presencePolicy: 'maintained',
    contextTiers: [],
    defaultBudgetTokens: 8192,
    controls: {
      fast: { state: 'unsupported' },
      maxContext: { state: 'unsupported' },
      reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    route: { protocol: 'OpenAIResponses', source: 'catalog' },
    toolCalling: { state: 'supported' },
    visionInput: { state: 'unsupported' },
    structuredOutput: { state: 'unsupported' },
    provenance: [],
    ...partial,
  } as unknown as EffectiveModel;
}

describe('composerModelPicker', () => {
  it('admits only Agent-executable models with source-backed tools', () => {
    expect(isComposerPickerModel(model({ modelId: 'ok' }))).toBe(true);
    expect(isComposerPickerModel(model({
      modelId: 'unverified',
      availability: 'unknown',
      toolCalling: { state: 'unknown' },
    }))).toBe(false);
    expect(isComposerPickerModel(model({
      modelId: 'unsupported',
      toolCalling: { state: 'unsupported' },
    }))).toBe(false);
    expect(isComposerPickerModel(model({ modelId: 'off', enabled: false }))).toBe(false);
    expect(isComposerPickerModel(model({ modelId: 'gone', availability: 'unavailable' }))).toBe(false);
    expect(isComposerPickerModel(model({
      modelId: 'hidden',
      selection: { pickerVisibility: 'internal' },
    }))).toBe(false);
  });

  it('uses the authoritative context range when a larger Max tier is reachable', () => {
    const entry = model({
      modelId: 'gpt',
      contextTiers: [
        { id: 'default', label: 'default', maxPromptTokens: 128000, activation: { kind: 'implicit' }, entitlement: 'granted' },
        { id: 'max', label: 'max', maxTotalTokens: 272000, activation: { kind: 'implicit' }, entitlement: 'granted' },
      ],
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'max' },
        reasoning: {
          kind: 'levels',
          supportsOff: true,
          levels: ['low', 'medium', 'high'],
          defaultSelection: 'medium',
          wireProfile: { kind: 'openai-responses' },
        },
      },
    });
    expect(resolvePickerContextWindow(entry)).toEqual({
      tokens: 272000,
      label: '128k → 272k',
    });
    expect(hasPickerReasoning(entry)).toBe(true);
  });

  it('filters by provider, model, label, and alias', () => {
    const options = [
      toComposerPickerOption('openai', 'OpenAI', model({
        modelId: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        aliases: ['sol'],
      })),
      toComposerPickerOption('kimi-coding-plan', 'Kimi Coding', model({
        modelId: 'k3',
        label: 'Kimi K3',
      })),
    ];
    expect(filterComposerPickerOptions(options, 'sol').map((item) => item.modelId)).toEqual(['gpt-5.6-sol']);
    expect(filterComposerPickerOptions(options, 'kimi').map((item) => item.modelId)).toEqual(['k3']);
    expect(groupComposerPickerOptions(options)).toHaveLength(2);
  });
});
